"""Funding and release logic.

``release_milestone`` is the ONLY place a payout is created. Agents never call PayPal; they can
only influence the milestone status that this service checks (guardrail from the build plan).
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlmodel import Session, select

from app.config import settings
from app.db.models import (
    AuditLog,
    Dispute,
    Funding,
    Milestone,
    Payout,
    Project,
    ReleaseDecision,
    User,
    utcnow,
)
from app.services.paypal_client import PayPalClient


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class ReleaseError(Exception):
    pass


def audit(session: Session, actor: str, action: str, entity: str, entity_id: int | None, **details):
    session.add(AuditLog(actor=actor, action=action, entity=entity, entity_id=entity_id,
                         details_json=json.dumps(details, default=str)))


def funded_amount(session: Session, project_id: int) -> float:
    rows = session.exec(select(Funding).where(Funding.project_id == project_id,
                                              Funding.status == "CAPTURED")).all()
    return sum(f.amount for f in rows)


def released_amount(session: Session, project_id: int) -> float:
    rows = session.exec(
        select(Payout).join(Milestone, Milestone.id == Payout.milestone_id)
        .where(Milestone.project_id == project_id, Payout.status != "FAILED")).all()
    return sum(p.amount for p in rows)


def start_funding(session: Session, pp: PayPalClient, project: Project) -> Funding:
    if project.status != "DRAFT":
        raise ReleaseError("project is not in DRAFT state")
    order = pp.create_order(project.total_amount, project.currency, f"project-{project.id}")
    funding = Funding(project_id=project.id, paypal_order_id=order["id"], amount=project.total_amount)
    session.add(funding)
    audit(session, "donor", "funding_order_created", "project", project.id, order_id=order["id"])
    session.commit()
    session.refresh(funding)
    funding.__dict__["approve_url"] = order.get("approve_url")
    return funding


def capture_funding(session: Session, pp: PayPalClient, funding: Funding) -> Funding:
    if funding.status == "CAPTURED":
        return funding  # idempotent
    res = pp.capture_order(funding.paypal_order_id)
    if res["status"] != "COMPLETED":
        funding.status = "FAILED"
        session.add(funding)
        session.commit()
        raise ReleaseError(f"capture not completed: {res['status']}")
    funding.status = "CAPTURED"
    funding.paypal_capture_id = res["capture_id"]
    project = session.get(Project, funding.project_id)
    project.status = "FUNDED"
    session.add_all([funding, project])
    audit(session, "system", "funding_captured", "project", project.id, capture_id=res["capture_id"])
    session.commit()
    return funding


def release_milestone(session: Session, pp: PayPalClient, milestone: Milestone,
                      actor: str, human_approved: bool = False) -> Payout:
    """Run hard rules, then create the payout. Idempotent per milestone."""
    existing = session.exec(select(Payout).where(Payout.milestone_id == milestone.id,
                                                 Payout.status != "FAILED")).first()
    if existing:
        return existing

    project = session.get(Project, milestone.project_id)
    if project.status != "FUNDED":
        raise ReleaseError("project is not funded")

    open_disputes = session.exec(
        select(Dispute).where(Dispute.milestone_id == milestone.id, Dispute.status == "OPEN")
    ).all()
    if open_disputes:
        raise ReleaseError("milestone has an open dispute")

    if milestone.status == "CHALLENGE_WINDOW":
        if milestone.challenge_ends_at and utcnow() < _aware(milestone.challenge_ends_at):
            raise ReleaseError("challenge window is still active")
        milestone.status = "APPROVED_FOR_RELEASE"

    if milestone.status != "APPROVED_FOR_RELEASE":
        raise ReleaseError("milestone is not approved for release")
    if milestone.tranche_amount > settings.human_approval_threshold and not human_approved:
        raise ReleaseError("amount above threshold requires human approval")
    available = funded_amount(session, project.id) - released_amount(session, project.id)
    if milestone.tranche_amount > available + 1e-9:
        raise ReleaseError("insufficient funded balance")
    payee = session.get(User, milestone.payee_user_id)
    if not payee or not payee.paypal_email:
        raise ReleaseError("payee has no PayPal email")

    # A failed earlier attempt leaves a FAILED row, so make the batch id unique per attempt.
    attempts = len(session.exec(select(Payout).where(Payout.milestone_id == milestone.id)).all())
    batch_id = f"milestone-{milestone.id}-{attempts + 1}"
    res = pp.create_payout(batch_id, payee.paypal_email, milestone.tranche_amount,
                           project.currency, f"ImpactRelease: {milestone.title}")
    payout = Payout(milestone_id=milestone.id, sender_batch_id=batch_id,
                    paypal_batch_id=res["batch_id"], amount=milestone.tranche_amount,
                    currency=project.currency, receiver_email=payee.paypal_email)
    milestone.status = "PAYOUT_SENT"
    session.add_all([payout, milestone])
    audit(session, actor, "payout_created", "milestone", milestone.id,
          amount=milestone.tranche_amount, batch_id=res["batch_id"])
    session.commit()
    session.refresh(payout)
    return payout


_PAYOUT_EVENTS = {
    "PAYMENT.PAYOUTSBATCH.SUCCESS": ("SUCCESS", "SETTLED"),
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": ("SUCCESS", "SETTLED"),
    "PAYMENT.PAYOUTS-ITEM.FAILED": ("FAILED", "PAYOUT_FAILED"),
    "PAYMENT.PAYOUTS-ITEM.DENIED": ("FAILED", "PAYOUT_FAILED"),
    "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": ("UNCLAIMED", "PAYOUT_SENT"),
    "PAYMENT.PAYOUTSBATCH.DENIED": ("FAILED", "PAYOUT_FAILED"),
}


def apply_payout_event(session: Session, event_type: str, resource: dict) -> bool:
    """Update payout/milestone from a PayPal webhook. Returns True if something changed."""
    mapping = _PAYOUT_EVENTS.get(event_type)
    if not mapping:
        return False
    payout_status, milestone_status = mapping
    batch_id = (resource.get("batch_header", {}).get("payout_batch_id")
                or resource.get("payout_batch_id"))
    sender_batch = (resource.get("batch_header", {}).get("sender_batch_header", {})
                    .get("sender_batch_id") or resource.get("payout_item", {}).get("sender_item_id"))
    payout = None
    if batch_id:
        payout = session.exec(select(Payout).where(Payout.paypal_batch_id == batch_id)).first()
    if not payout and sender_batch:
        payout = session.exec(select(Payout).where(Payout.sender_batch_id == sender_batch)).first()
    if not payout or payout.status == payout_status:
        return False
    payout.status = payout_status
    milestone = session.get(Milestone, payout.milestone_id)
    milestone.status = milestone_status
    session.add_all([payout, milestone])
    audit(session, "paypal", f"webhook:{event_type}", "payout", payout.id, status=payout_status)
    session.commit()
    return True


def evaluate_and_decide_milestone(session: Session, milestone: Milestone) -> dict[str, Any]:
    """Run the deterministic rules engine + Release Agent on a milestone."""
    from app.agents.release_agent import decide_release
    from app.services.rules_engine import evaluate_milestone_rules

    if milestone.status in ("PAYOUT_SENT", "SETTLED"):
        raise ReleaseError(f"milestone is already {milestone.status}")

    rules = evaluate_milestone_rules(session, milestone)
    agent_out = decide_release(milestone.title, milestone.tranche_amount, rules)

    now = utcnow()
    if agent_out.decision == "release":
        if milestone.challenge_window_hours > 0:
            milestone.status = "CHALLENGE_WINDOW"
            milestone.challenge_ends_at = now + timedelta(hours=milestone.challenge_window_hours)
        else:
            milestone.status = "APPROVED_FOR_RELEASE"
            milestone.challenge_ends_at = now
    elif agent_out.decision == "review":
        milestone.status = "HUMAN_REVIEW"
    elif agent_out.decision == "needs_more_evidence":
        milestone.status = "NEEDS_MORE_EVIDENCE"
    else:
        milestone.status = "HELD"

    row = ReleaseDecision(
        milestone_id=milestone.id,
        decision=agent_out.decision,
        confidence=agent_out.confidence,
        rules_passed=rules.all_passed,
        rules_json=rules.model_dump_json(),
        explanation=agent_out.explanation,
        decided_by="agent",
    )
    session.add_all([milestone, row])
    audit(
        session,
        f"release_agent:{agent_out.source}",
        "release_evaluated",
        "milestone",
        milestone.id,
        decision=agent_out.decision,
        rules_passed=rules.all_passed,
        milestone_status=milestone.status,
    )
    session.commit()
    session.refresh(row)
    return {
        "decision_id": row.id,
        "milestone_id": milestone.id,
        "milestone_status": milestone.status,
        "challenge_ends_at": milestone.challenge_ends_at,
        "decision": row.decision,
        "confidence": row.confidence,
        "rules_passed": row.rules_passed,
        "rules": rules.model_dump(),
        "explanation": row.explanation,
        "decided_by": row.decided_by,
    }


def raise_dispute(session: Session, milestone: Milestone, raised_by: str, reason: str) -> Dispute:
    if milestone.status in ("SETTLED", "PAYOUT_SENT"):
        raise ReleaseError(f"cannot dispute a milestone that is {milestone.status}")
    dispute = Dispute(
        milestone_id=milestone.id,
        raised_by=raised_by.strip()[:120],
        reason=reason.strip()[:1000],
        status="OPEN",
    )
    milestone.status = "DISPUTED"
    session.add_all([dispute, milestone])
    audit(
        session,
        dispute.raised_by,
        "dispute_raised",
        "milestone",
        milestone.id,
        reason=dispute.reason,
    )
    session.commit()
    session.refresh(dispute)
    return dispute


def human_review_decision(
    session: Session, milestone: Milestone, reviewer: str, decision: str, comment: str = ""
) -> ReleaseDecision:
    if decision not in ("approve", "reject"):
        raise ReleaseError("decision must be 'approve' or 'reject'")
    if milestone.status in ("SETTLED", "PAYOUT_SENT"):
        raise ReleaseError(f"milestone is already {milestone.status}")

    open_disputes = session.exec(
        select(Dispute).where(Dispute.milestone_id == milestone.id, Dispute.status == "OPEN")
    ).all()
    for d in open_disputes:
        d.status = "RESOLVED_RELEASE" if decision == "approve" else "RESOLVED_REJECT"
        session.add(d)

    now = utcnow()
    if decision == "approve":
        if milestone.challenge_window_hours > 0 and not milestone.challenge_ends_at:
            milestone.status = "CHALLENGE_WINDOW"
            milestone.challenge_ends_at = now + timedelta(hours=milestone.challenge_window_hours)
        else:
            milestone.status = "APPROVED_FOR_RELEASE"
    else:
        milestone.status = "REJECTED"

    row = ReleaseDecision(
        milestone_id=milestone.id,
        decision="release" if decision == "approve" else "reject",
        confidence=1.0,
        rules_passed=(decision == "approve"),
        rules_json=json.dumps({"human_override": True, "comment": comment}),
        explanation=comment or f"Human reviewer ({reviewer}) decided to {decision}.",
        decided_by=f"human:{reviewer}",
    )
    session.add_all([milestone, row])
    audit(
        session,
        reviewer,
        f"human_review_{decision}",
        "milestone",
        milestone.id,
        comment=comment,
        milestone_status=milestone.status,
    )
    session.commit()
    session.refresh(row)
    return row


def release_project_holdback(
    session: Session, pp: PayPalClient, project: Project, actor: str = "system"
) -> Payout:
    """Release the retained holdback after all regular milestones have settled."""
    if project.status != "FUNDED":
        raise ReleaseError(f"project is {project.status}")
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project.id).order_by(Milestone.order_no)
    ).all()
    regular = [m for m in milestones if not m.is_holdback]
    if not regular or not all(m.status in ("SETTLED", "PAYOUT_SENT") for m in regular):
        raise ReleaseError("all regular milestones must be settled or paid before releasing holdback")

    for m in regular:
        open_d = session.exec(
            select(Dispute).where(Dispute.milestone_id == m.id, Dispute.status == "OPEN")
        ).first()
        if open_d:
            raise ReleaseError("cannot release holdback while a milestone has an open dispute")

    remaining = round(funded_amount(session, project.id) - released_amount(session, project.id), 2)
    if remaining <= 0:
        raise ReleaseError("no holdback balance remaining")

    hb_ms = next((m for m in milestones if m.is_holdback), None)
    if not hb_ms:
        payee_id = project.org_id or regular[-1].payee_user_id
        hb_ms = Milestone(
            project_id=project.id,
            order_no=len(milestones) + 1,
            title="Final retention holdback release",
            description="Released after all project milestones were verified and settled.",
            tranche_amount=remaining,
            payee_user_id=payee_id,
            is_holdback=True,
            status="APPROVED_FOR_RELEASE",
        )
        session.add(hb_ms)
        session.flush()
    else:
        hb_ms.status = "APPROVED_FOR_RELEASE"
        session.add(hb_ms)
        session.flush()

    payout = release_milestone(session, pp, hb_ms, actor=actor, human_approved=True)
    project.status = "COMPLETED"
    session.add(project)
    audit(session, actor, "holdback_released", "project", project.id, amount=remaining)
    session.commit()
    session.refresh(payout)
    return payout
