import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.models import Analysis, Confirmation, Dispute, Milestone, Project, ReleaseDecision, Submission
from app.db.session import get_session
from app.services import confirmations as cf
from app.services import release_service as rs
from app.services.paypal_client import PayPalClient, PayPalError, get_paypal

router = APIRouter()


class InviteIn(BaseModel):
    kind: str = Field(pattern="^(vendor|beneficiary|witness)$")
    contact_ref: str = Field(min_length=2, max_length=200)


class ConfirmSubmitIn(BaseModel):
    confirmed: bool
    reported_amount: float | None = None
    answers: dict[str, Any] = {}
    free_text: str = ""


class DisputeIn(BaseModel):
    raised_by: str = Field(min_length=2, max_length=120)
    reason: str = Field(min_length=5, max_length=1000)


class ReviewDecisionIn(BaseModel):
    reviewer: str = "reviewer"
    decision: str = Field(pattern="^(approve|reject)$")
    comment: str = ""


class HoldbackIn(BaseModel):
    actor: str = "reviewer"


def _milestone(session: Session, milestone_id: int) -> Milestone:
    m = session.get(Milestone, milestone_id)
    if not m:
        raise HTTPException(404, "milestone not found")
    return m


# ---------- confirmation invites & tokenized submission ----------
@router.post("/milestones/{milestone_id}/confirmations/invite")
def invite_confirmation(
    milestone_id: int, body: InviteIn, session: Session = Depends(get_session)
):
    m = _milestone(session, milestone_id)
    try:
        conf, raw_token = cf.create_confirmation_invite(session, m, body.kind, body.contact_ref)
    except cf.ConfirmationError as e:
        raise HTTPException(422, str(e))
    return {
        "confirmation_id": conf.id,
        "milestone_id": m.id,
        "kind": conf.kind,
        "token": raw_token,
        "confirm_url": f"/confirm/{raw_token}",
    }


@router.get("/milestones/{milestone_id}/confirmations")
def list_confirmations(milestone_id: int, session: Session = Depends(get_session)):
    _milestone(session, milestone_id)
    rows = session.exec(
        select(Confirmation)
        .where(Confirmation.milestone_id == milestone_id)
        .order_by(Confirmation.id)
    ).all()
    return [
        {
            "id": r.id,
            "kind": r.kind,
            "contact_ref": r.contact_ref,
            "status": r.status,
            "confirmed": r.confirmed,
            "reported_amount": r.reported_amount,
            "matched": r.matched,
            "flags": json.loads(r.flags_json or "[]"),
            "responded_at": r.responded_at,
        }
        for r in rows
    ]


@router.get("/confirm/{token}")
def get_confirm_prompt(token: str, session: Session = Depends(get_session)):
    try:
        conf, milestone = cf.get_confirmation_by_token(session, token)
    except cf.ConfirmationError as e:
        raise HTTPException(404, str(e))
    questions = (
        [
            "What goods or services were delivered for this order?",
            "What total amount was billed or received?",
        ]
        if conf.kind == "vendor"
        else [
            "What specific support, item, or class did you receive?",
            "When did it start or arrive?",
        ]
    )
    return {
        "confirmation_id": conf.id,
        "kind": conf.kind,
        "status": conf.status,
        "milestone_title": milestone.title,
        "milestone_description": milestone.description,
        "questions": questions,
    }


@router.post("/confirm/{token}")
def submit_confirm_response(
    token: str, body: ConfirmSubmitIn, session: Session = Depends(get_session)
):
    try:
        conf = cf.submit_confirmation(
            session,
            token=token,
            confirmed=body.confirmed,
            reported_amount=body.reported_amount,
            answers=body.answers,
            free_text=body.free_text,
        )
    except cf.ConfirmationError as e:
        raise HTTPException(409, str(e))
    return {
        "confirmation_id": conf.id,
        "status": conf.status,
        "confirmed": conf.confirmed,
        "matched": conf.matched,
        "flags": json.loads(conf.flags_json or "[]"),
    }


# ---------- release evaluation & decisions ----------
@router.post("/milestones/{milestone_id}/decision")
def evaluate_milestone_decision(milestone_id: int, session: Session = Depends(get_session)):
    m = _milestone(session, milestone_id)
    try:
        return rs.evaluate_and_decide_milestone(session, m)
    except rs.ReleaseError as e:
        raise HTTPException(409, str(e))


@router.get("/milestones/{milestone_id}/decision")
def get_milestone_decision(milestone_id: int, session: Session = Depends(get_session)):
    m = _milestone(session, milestone_id)
    row = session.exec(
        select(ReleaseDecision)
        .where(ReleaseDecision.milestone_id == milestone_id)
        .order_by(ReleaseDecision.id.desc())
    ).first()
    if not row:
        return rs.evaluate_and_decide_milestone(session, m)
    return {
        "decision_id": row.id,
        "milestone_id": m.id,
        "milestone_status": m.status,
        "challenge_ends_at": m.challenge_ends_at,
        "decision": row.decision,
        "confidence": row.confidence,
        "rules_passed": row.rules_passed,
        "rules": json.loads(row.rules_json or "{}"),
        "explanation": row.explanation,
        "decided_by": row.decided_by,
    }


# ---------- challenge window disputes ----------
@router.post("/milestones/{milestone_id}/dispute")
def dispute_milestone(
    milestone_id: int, body: DisputeIn, session: Session = Depends(get_session)
):
    m = _milestone(session, milestone_id)
    try:
        d = rs.raise_dispute(session, m, body.raised_by, body.reason)
    except rs.ReleaseError as e:
        raise HTTPException(409, str(e))
    return {
        "dispute_id": d.id,
        "milestone_id": m.id,
        "milestone_status": m.status,
        "status": d.status,
        "reason": d.reason,
    }


# ---------- human reviewer queue & decision ----------
@router.get("/review/queue")
def get_review_queue(session: Session = Depends(get_session)):
    """Items requiring human review (used by the AG Grid reviewer console)."""
    milestones = session.exec(
        select(Milestone)
        .where(Milestone.status.in_(["HUMAN_REVIEW", "DISPUTED", "HELD"]))
        .order_by(Milestone.id.desc())
    ).all()
    queue = []
    for m in milestones:
        sub = session.exec(
            select(Submission)
            .where(Submission.milestone_id == m.id)
            .order_by(Submission.id.desc())
        ).first()
        skeptic_risk = 0.0
        concerns: list[Any] = []
        if sub:
            s_row = session.exec(
                select(Analysis).where(
                    Analysis.submission_id == sub.id, Analysis.agent == "skeptic"
                )
            ).first()
            if s_row:
                skeptic_risk = s_row.score
                concerns = json.loads(s_row.signals_json or "{}").get("concerns", [])
        disputes = session.exec(
            select(Dispute).where(Dispute.milestone_id == m.id, Dispute.status == "OPEN")
        ).all()
        confs = session.exec(
            select(Confirmation).where(Confirmation.milestone_id == m.id)
        ).all()
        queue.append({
            "milestone_id": m.id,
            "project_id": m.project_id,
            "title": m.title,
            "tranche_amount": m.tranche_amount,
            "status": m.status,
            "skeptic_risk": skeptic_risk,
            "concerns": concerns,
            "open_disputes": [{"id": d.id, "raised_by": d.raised_by, "reason": d.reason} for d in disputes],
            "confirmations_matched": sum(1 for c in confs if c.matched),
            "confirmations_total": len(confs),
        })
    return queue


@router.post("/review/{milestone_id}/decision")
def post_review_decision(
    milestone_id: int, body: ReviewDecisionIn, session: Session = Depends(get_session)
):
    m = _milestone(session, milestone_id)
    try:
        row = rs.human_review_decision(session, m, body.reviewer, body.decision, body.comment)
    except rs.ReleaseError as e:
        raise HTTPException(409, str(e))
    return {
        "decision_id": row.id,
        "milestone_id": m.id,
        "milestone_status": m.status,
        "decision": row.decision,
        "decided_by": row.decided_by,
        "explanation": row.explanation,
    }


# ---------- final retention holdback release ----------
@router.post("/projects/{project_id}/release-holdback")
def release_holdback(
    project_id: int,
    body: HoldbackIn,
    session: Session = Depends(get_session),
    pp: PayPalClient = Depends(get_paypal),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    try:
        payout = rs.release_project_holdback(session, pp, project, actor=body.actor)
    except rs.ReleaseError as e:
        raise HTTPException(409, str(e))
    except PayPalError as e:
        raise HTTPException(502, str(e))
    return payout
