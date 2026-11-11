"""Deterministic rules engine for milestone release decisions.

The LLM can never waive these rules. Every check produces a boolean and a human-readable detail so
reviewers and donors can see exactly why a tranche was released, held, or sent to human review.
"""
import json
from typing import Any

from pydantic import BaseModel
from sqlmodel import Session, select

from app.agents.investigation_workflow import run_investigation_workflow
from app.config import settings
from app.db.models import Analysis, Confirmation, Dispute, Milestone, Project, Submission, User
from app.services.release_service import funded_amount, released_amount


class RuleCheck(BaseModel):
    passed: bool
    detail: str


class RuleEvaluation(BaseModel):
    all_passed: bool
    deterministic_outcome: str  # release | review | hold | needs_more_evidence
    checks: dict[str, RuleCheck]


def evaluate_milestone_rules(session: Session, milestone: Milestone) -> RuleEvaluation:
    project = session.get(Project, milestone.project_id)
    payee = session.get(User, milestone.payee_user_id)
    checks: dict[str, RuleCheck] = {}

    # 1. Project funded and sufficient balance
    avail = (funded_amount(session, project.id) - released_amount(session, project.id)) if project else 0.0
    funded_ok = bool(project and project.status == "FUNDED" and avail + 1e-9 >= milestone.tranche_amount)
    checks["project_funded"] = RuleCheck(
        passed=funded_ok,
        detail=(f"Project status={project.status if project else 'NONE'}, "
                f"available={avail:.2f}, tranche={milestone.tranche_amount:.2f}"),
    )

    # 2 & 3. Latest submission Verifier and Skeptic analyses
    sub = session.exec(
        select(Submission)
        .where(Submission.milestone_id == milestone.id)
        .order_by(Submission.id.desc())
    ).first()

    code_ok = False
    skeptic_ok = False
    code_detail = "No evidence submission yet"
    skeptic_detail = "No skeptic analysis yet"

    if sub:
        analyses = session.exec(
            select(Analysis).where(Analysis.submission_id == sub.id)
        ).all()
        by_agent = {a.agent: json.loads(a.signals_json) for a in analyses}
        v = by_agent.get("verifier")
        s = by_agent.get("skeptic")
        if v:
            code_ok = bool(v.get("challenge_code_visible"))
            code_detail = (f"Challenge code {'visible' if code_ok else 'NOT visible'} "
                           f"(confidence {v.get('confidence', 0):.2f})")
        if s:
            rec = s.get("recommendation", "hold")
            risk = float(s.get("fraud_risk", 1.0))
            skeptic_ok = rec == "pass" and risk < 0.40
            skeptic_detail = f"Skeptic recommendation={rec}, fraud_risk={risk:.2f}"

    checks["challenge_code_verified"] = RuleCheck(passed=code_ok, detail=code_detail)
    checks["skeptic_cleared"] = RuleCheck(passed=skeptic_ok, detail=skeptic_detail)

    # 4. Independent third-party confirmation
    confs = session.exec(
        select(Confirmation).where(
            Confirmation.milestone_id == milestone.id,
            Confirmation.status == "SUBMITTED",
        )
    ).all()
    contradictions = [
        c for c in confs if not c.confirmed or json.loads(c.flags_json or "[]")
    ]
    matched_vw = [c for c in confs if c.matched and c.kind in ("vendor", "witness")]
    matched_ben = [c for c in confs if c.matched and c.kind == "beneficiary"]
    min_ben = settings.min_beneficiary_confirmations
    conf_ok = (not contradictions) and (len(matched_vw) >= 1 or len(matched_ben) >= min_ben)
    if contradictions:
        conf_detail = f"{len(contradictions)} confirmation(s) denied or flagged for contradiction/rehearsal"
    else:
        conf_detail = (f"{len(matched_vw)} vendor/witness and {len(matched_ben)}/{min_ben} "
                       f"beneficiary confirmations matched")
    checks["independent_confirmation_met"] = RuleCheck(passed=conf_ok, detail=conf_detail)

    # 5. No open disputes
    open_disputes = session.exec(
        select(Dispute).where(Dispute.milestone_id == milestone.id, Dispute.status == "OPEN")
    ).all()
    no_disputes = len(open_disputes) == 0
    checks["no_open_disputes"] = RuleCheck(
        passed=no_disputes,
        detail="No open disputes" if no_disputes else f"{len(open_disputes)} open dispute(s)",
    )

    # 6. Outcome & Functionality Investigation Workflow
    reqs = json.loads(milestone.evidence_requirements_json or "[]")
    inv_res = run_investigation_workflow(
        milestone_title=milestone.title,
        tranche_amount=milestone.tranche_amount,
        evidence_requirements=reqs,
        verifier_signals=v or {},
        skeptic_signals=s or {},
        confirmations_summary={
            "matched_vendor": len(matched_vw) >= 1,
            "matched_beneficiaries": len(matched_ben),
            "contradictions": len(contradictions),
        },
    )
    outcome_ok = (not inv_res.requires_investigation) or (inv_res.outcome_status == "VERIFIED_FUNCTIONAL")
    checks["outcome_functionality_established"] = RuleCheck(
        passed=outcome_ok,
        detail=inv_res.outcome_explanation,
    )

    # 7. Trust-tier automatic approval threshold
    tier = payee.trust_tier if payee else 0
    limit = settings.human_approval_threshold * (1.0 + 0.5 * max(0, tier))
    within_limit = milestone.tranche_amount <= limit + 1e-9
    checks["within_auto_approval_limit"] = RuleCheck(
        passed=within_limit,
        detail=f"Tranche {milestone.tranche_amount:.2f} vs tier-{tier} limit {limit:.2f}",
    )

    all_passed = all(c.passed for c in checks.values())
    if all_passed:
        outcome = "release"
    elif not no_disputes or contradictions or (sub and not skeptic_ok) or inv_res.outcome_status == "SUSPICIOUS_CONTRADICTION":
        outcome = "review"
    elif not sub or not code_ok or not conf_ok or not outcome_ok:
        outcome = "needs_more_evidence"
    elif not within_limit:
        outcome = "review"
    else:
        outcome = "hold"

    return RuleEvaluation(
        all_passed=all_passed,
        deterministic_outcome=outcome,
        checks=checks,
    )
