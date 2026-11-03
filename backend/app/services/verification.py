"""Verification pipeline: runs Verifier + Similarity Search + Skeptic on a submission."""
import json
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.agents.skeptic_agent import SkepticResult, run_skeptic
from app.agents.verifier_agent import VerifierResult, verify_submission
from app.db.models import Analysis, Challenge, EvidenceItem, Milestone, Submission
from app.services.release_service import audit
from app.services.similarity import find_similar_evidence, index_in_elastic


class VerificationError(Exception):
    pass


def analyze_submission(session: Session, submission_id: int) -> dict[str, Any]:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise VerificationError("submission not found")
    milestone = session.get(Milestone, submission.milestone_id)
    challenge = session.get(Challenge, submission.challenge_id)
    items = session.exec(
        select(EvidenceItem).where(EvidenceItem.submission_id == submission.id)
    ).all()
    if not milestone or not challenge or not items:
        raise VerificationError("submission is missing milestone, challenge, or files")

    files: list[tuple[str, str, bytes]] = []
    for item in items:
        p = Path(item.stored_path)
        data = p.read_bytes() if p.exists() else b""
        files.append((item.filename, item.content_type, data))

    reqs: list[str] = json.loads(milestone.evidence_requirements_json or "[]")
    verifier: VerifierResult = verify_submission(
        milestone_title=milestone.title,
        milestone_description=milestone.description,
        tranche_amount=milestone.tranche_amount,
        evidence_requirements=reqs,
        expected_challenge_code=challenge.code,
        files=files,
    )

    # Persist extracted text on items and index in Elastic (if enabled) before similarity search.
    for item in items:
        if verifier.extracted_text and not item.extracted_text:
            item.extracted_text = verifier.extracted_text[:2000]
            session.add(item)
        index_in_elastic(item, milestone.id, milestone.project_id)
    session.flush()

    similarity_hits = find_similar_evidence(session, submission, items)
    sub_flags: list[dict[str, Any]] = json.loads(submission.flags_json or "[]")
    geo: dict[str, Any] = json.loads(submission.geo_json or "{}")

    skeptic: SkepticResult = run_skeptic(
        milestone_title=milestone.title,
        milestone_description=milestone.description,
        tranche_amount=milestone.tranche_amount,
        submission_flags=sub_flags,
        geo=geo,
        verifier=verifier,
        similarity_hits=similarity_hits,
        files=files,
    )

    # Remove old analyses if re-analyzing the same submission.
    old = session.exec(select(Analysis).where(Analysis.submission_id == submission.id)).all()
    for row in old:
        session.delete(row)

    v_row = Analysis(
        submission_id=submission.id,
        agent="verifier",
        source=verifier.source,
        signals_json=verifier.model_dump_json(),
        score=verifier.confidence,
        explanation=verifier.explanation,
    )
    s_row = Analysis(
        submission_id=submission.id,
        agent="skeptic",
        source=skeptic.source,
        signals_json=skeptic.model_dump_json(),
        score=skeptic.fraud_risk,
        explanation=skeptic.explanation,
    )
    session.add_all([v_row, s_row])

    # Update submission & milestone statuses based on findings.
    non_code_concerns = [
        c for c in skeptic.concerns if c.code != "CHALLENGE_CODE_NOT_VISIBLE" and c.severity >= 0.5
    ]
    if skeptic.recommendation == "pass" and verifier.challenge_code_visible:
        submission.status = "VERIFIED"
        milestone.status = "ANALYZED"
    elif similarity_hits or non_code_concerns:
        submission.status = "FLAGGED"
        milestone.status = "HUMAN_REVIEW"
    elif not verifier.challenge_code_visible:
        submission.status = "NEEDS_MORE_EVIDENCE"
        milestone.status = "NEEDS_MORE_EVIDENCE"
    else:
        submission.status = "FLAGGED"
        milestone.status = "HUMAN_REVIEW"

    session.add_all([submission, milestone])
    audit(
        session,
        "system",
        "submission_analyzed",
        "submission",
        submission.id,
        verifier_confidence=verifier.confidence,
        challenge_code_visible=verifier.challenge_code_visible,
        skeptic_risk=skeptic.fraud_risk,
        skeptic_recommendation=skeptic.recommendation,
        similarity_hits=len(similarity_hits),
        milestone_status=milestone.status,
    )
    session.commit()

    return {
        "submission_id": submission.id,
        "submission_status": submission.status,
        "milestone_id": milestone.id,
        "milestone_status": milestone.status,
        "verifier": verifier.model_dump(),
        "skeptic": skeptic.model_dump(),
        "similarity_hits": similarity_hits,
    }


def get_submission_analysis(session: Session, submission_id: int) -> dict[str, Any]:
    submission = session.get(Submission, submission_id)
    if not submission:
        raise VerificationError("submission not found")
    rows = session.exec(
        select(Analysis).where(Analysis.submission_id == submission_id).order_by(Analysis.id)
    ).all()
    if not rows:
        return analyze_submission(session, submission_id)
    milestone = session.get(Milestone, submission.milestone_id)
    by_agent = {r.agent: json.loads(r.signals_json) for r in rows}
    return {
        "submission_id": submission.id,
        "submission_status": submission.status,
        "milestone_id": submission.milestone_id,
        "milestone_status": milestone.status if milestone else None,
        "verifier": by_agent.get("verifier"),
        "skeptic": by_agent.get("skeptic"),
    }
