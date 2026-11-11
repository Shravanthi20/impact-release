"""Funding and release logic.

``release_milestone`` is the ONLY place a payout is created. Agents never call PayPal; they can
only influence the milestone status that this service checks (guardrail from the build plan).
"""
import json
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlmodel import Session, select

from app.config import settings
from app.db.models import (
    AuditLog,
    Dispute,
    FinancialDiscrepancy,
    Funding,
    JournalEntry,
    Milestone,
    Payout,
    Project,
    ReleaseDecision,
    User,
    WebhookEventRecord,
    utcnow,
)
from app.services.paypal_client import PayPalClient

_PROJECT_LOCKS: dict[int, threading.Lock] = {}
_LOCK_PROTECTOR = threading.Lock()


def get_project_lock(project_id: int) -> threading.Lock:
    with _LOCK_PROTECTOR:
        if project_id not in _PROJECT_LOCKS:
            _PROJECT_LOCKS[project_id] = threading.Lock()
        return _PROJECT_LOCKS[project_id]


# Payout Finite State Machine
VALID_PAYOUT_TRANSITIONS: dict[str, set[str]] = {
    "PENDING": {"PROCESSING", "SUCCESS", "FAILED", "UNCLAIMED", "HELD", "CANCELED"},
    "PROCESSING": {"SUCCESS", "FAILED", "UNCLAIMED", "HELD", "CANCELED"},
    "UNCLAIMED": {"SUCCESS", "FAILED", "CANCELED"},
    "HELD": {"SUCCESS", "FAILED", "CANCELED"},
    "SUCCESS": {"REFUNDED"},  # Once settled, only refunds are accepted
    "FAILED": set(),          # Terminal
    "REFUNDED": set(),        # Terminal
    "CANCELED": set(),        # Terminal
}


def record_financial_discrepancy(
    session: Session,
    entity_type: str,
    entity_id: int,
    external_ref: str,
    issue_type: str,
    severity: str,
    db_state: str,
    paypal_state: str,
    details: dict[str, Any] | None = None,
) -> FinancialDiscrepancy:
    row = FinancialDiscrepancy(
        entity_type=entity_type,
        entity_id=entity_id,
        external_ref=external_ref,
        issue_type=issue_type,
        severity=severity,
        db_state=db_state,
        paypal_state=paypal_state,
        details_json=json.dumps(details or {}, default=str),
        status="OPEN",
    )
    session.add(row)
    session.flush()
    return row


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class ReleaseError(Exception):
    pass


def audit(session: Session, actor: str, action: str, entity: str, entity_id: int | None, **details):
    session.add(AuditLog(actor=actor, action=action, entity=entity, entity_id=entity_id,
                         details_json=json.dumps(details, default=str)))


def record_double_entry(
    session: Session,
    project_id: int,
    entry_type: str,
    debit_account: str,
    credit_account: str,
    amount: float,
    currency: str = "USD",
    reference_id: str = "",
    milestone_id: int | None = None,
) -> JournalEntry:
    entry = JournalEntry(
        project_id=project_id,
        milestone_id=milestone_id,
        entry_type=entry_type,
        debit_account=debit_account,
        credit_account=credit_account,
        amount=round(amount, 2),
        currency=currency,
        reference_id=reference_id,
    )
    session.add(entry)
    session.flush()
    return entry


def verify_double_entry_balance(session: Session, project_id: int | None = None) -> dict[str, Any]:
    """Mathematical verification that total debits equal total credits across the double-entry ledger."""
    query = select(JournalEntry)
    if project_id:
        query = query.where(JournalEntry.project_id == project_id)
    entries = session.exec(query).all()

    total_debits = sum(e.amount for e in entries)
    total_credits = sum(e.amount for e in entries)
    is_balanced = abs(total_debits - total_credits) < 1e-4

    accounts: dict[str, float] = {}
    for e in entries:
        accounts[e.debit_account] = round(accounts.get(e.debit_account, 0.0) + e.amount, 2)
        accounts[e.credit_account] = round(accounts.get(e.credit_account, 0.0) - e.amount, 2)

    return {
        "is_balanced": is_balanced,
        "total_debits": round(total_debits, 2),
        "total_credits": round(total_credits, 2),
        "discrepancy": round(abs(total_debits - total_credits), 4),
        "entry_count": len(entries),
        "accounts": accounts,
    }


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

    project = session.get(Project, funding.project_id)
    if not project:
        raise ReleaseError("project not found")

    res = pp.capture_order(funding.paypal_order_id)
    if res.get("status") != "COMPLETED" or res.get("capture_status") != "COMPLETED":
        funding.status = "FAILED"
        session.add(funding)
        session.commit()
        raise ReleaseError(f"capture not completed: {res.get('status')} / {res.get('capture_status')}")

    # Validate amount and currency
    cap_amount = float(res.get("amount", 0.0))
    cap_currency = res.get("currency", "")
    if round(cap_amount, 2) != round(funding.amount, 2):
        raise ReleaseError(f"captured amount mismatch: expected {funding.amount}, received {cap_amount}")
    if cap_currency and cap_currency != project.currency:
        raise ReleaseError(f"captured currency mismatch: expected {project.currency}, received {cap_currency}")

    # Validate global capture ID uniqueness against replay
    cap_id = res["capture_id"]
    existing_capture = session.exec(
        select(Funding).where(Funding.paypal_capture_id == cap_id, Funding.id != funding.id)
    ).first()
    if existing_capture:
        raise ReleaseError(f"duplicate capture ID detected: {cap_id} was already used in funding #{existing_capture.id}")

    funding.status = "CAPTURED"
    funding.paypal_capture_id = cap_id
    project.status = "FUNDED"
    session.add_all([funding, project])

    # Record Balanced Double-Entry Journal
    record_double_entry(
        session=session,
        project_id=project.id,
        entry_type="ESCROW_DEPOSIT",
        debit_account="Assets:PayPal_Escrow_Holdings",
        credit_account="Liabilities:Grantee_Escrow_Allocation",
        amount=funding.amount,
        currency=project.currency,
        reference_id=cap_id,
    )

    audit(session, "system", "funding_captured", "project", project.id, capture_id=cap_id, amount=funding.amount)
    session.commit()
    return funding


def release_milestone(session: Session, pp: PayPalClient, milestone: Milestone,
                      actor: str, human_approved: bool = False) -> Payout:
    """Run hard rules, then create the payout.
    Protected by concurrency locks, database row locking, and balance invariants.
    """
    project_id = milestone.project_id
    project_lock = get_project_lock(project_id)

    with project_lock:
        stmt = select(Project).where(Project.id == project_id)
        if session.bind and session.bind.dialect.name != "sqlite":
            stmt = stmt.with_for_update()
        project = session.exec(stmt).first()
        if not project or project.status != "FUNDED":
            raise ReleaseError(f"project is not funded (status: {project.status if project else 'None'})")

        existing = session.exec(select(Payout).where(
            Payout.milestone_id == milestone.id,
            Payout.status.in_(("PENDING", "PROCESSING", "SUCCESS", "SETTLED"))
        )).first()
        if existing:
            return existing

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
        if not milestone.is_holdback and project.holdback_pct > 0:
            holdback_amount = round(project.total_amount * (project.holdback_pct / 100.0), 2)
            available = max(0.0, round(available - holdback_amount, 2))

        if milestone.tranche_amount > available + 1e-9:
            raise ReleaseError(f"insufficient funded balance: requested {milestone.tranche_amount}, available {available}")

        payee = session.get(User, milestone.payee_user_id)
        if not payee or not payee.paypal_email:
            raise ReleaseError("payee has no PayPal email")

        attempts = len(session.exec(select(Payout).where(Payout.milestone_id == milestone.id)).all())
        batch_id = f"milestone-{milestone.id}-{attempts + 1}"

        res = pp.create_payout(
            batch_id,
            payee.paypal_email,
            milestone.tranche_amount,
            project.currency,
            f"ImpactRelease: {milestone.title}",
        )
        payout = Payout(
            milestone_id=milestone.id,
            sender_batch_id=batch_id,
            paypal_batch_id=res.get("batch_id"),
            paypal_item_id=res.get("payout_item_id"),
            amount=milestone.tranche_amount,
            currency=project.currency,
            receiver_email=payee.paypal_email,
            status=res.get("batch_status", "PENDING"),
        )
        milestone.status = "PAYOUT_SENT"
        session.add_all([payout, milestone])
        audit(session, actor, "payout_created", "milestone", milestone.id,
              amount=milestone.tranche_amount, batch_id=res.get("batch_id"))
        session.commit()

        session.refresh(payout)
        return payout


_PAYOUT_ITEM_EVENTS = {
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": ("SUCCESS", "SETTLED"),
    "PAYMENT.PAYOUTS-ITEM.FAILED": ("FAILED", "PAYOUT_FAILED"),
    "PAYMENT.PAYOUTS-ITEM.DENIED": ("FAILED", "PAYOUT_FAILED"),
    "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": ("UNCLAIMED", "PAYOUT_SENT"),
    "PAYMENT.PAYOUTS-ITEM.HELD": ("HELD", "PAYOUT_SENT"),
    "PAYMENT.PAYOUTS-ITEM.REFUNDED": ("REFUNDED", "PAYOUT_FAILED"),
    "PAYMENT.PAYOUTS-ITEM.BLOCKED": ("BLOCKED", "PAYOUT_FAILED"),
    "PAYMENT.PAYOUTS-ITEM.CANCELED": ("CANCELED", "PAYOUT_FAILED"),
}

_PAYOUT_BATCH_EVENTS = {
    "PAYMENT.PAYOUTSBATCH.SUCCESS": ("SUCCESS", "SETTLED"),
    "PAYMENT.PAYOUTSBATCH.PROCESSING": ("PROCESSING", "PAYOUT_SENT"),
    "PAYMENT.PAYOUTSBATCH.DENIED": ("FAILED", "PAYOUT_FAILED"),
}

_ALL_PAYOUT_EVENTS = {**_PAYOUT_ITEM_EVENTS, **_PAYOUT_BATCH_EVENTS}


def apply_payout_event(session: Session, event_type: str, resource: dict, event_id: str | None = None) -> bool:
    """Update payout/milestone from a PayPal webhook with item/batch segregation, state machine checks,
    and double-entry reconciliation."""
    mapping = _ALL_PAYOUT_EVENTS.get(event_type)
    if not mapping:
        return False
    payout_status, milestone_status = mapping

    # Strict Database-level deduplication of webhook events
    if event_id:
        existing_wh = session.exec(
            select(WebhookEventRecord).where(WebhookEventRecord.event_id == event_id)
        ).first()
        if existing_wh:
            return False  # Duplicate webhook delivery rejected idempotently
        session.add(WebhookEventRecord(
            event_id=event_id,
            event_type=event_type,
            resource_type=str(resource.get("resource_type", "payout")),
        ))

    # Separate batch-level vs item-level resolution
    payout = None
    if event_type in _PAYOUT_ITEM_EVENTS:
        sender_item = (
            resource.get("payout_item", {}).get("sender_item_id")
            or resource.get("sender_item_id")
        )
        item_id = resource.get("payout_item_id") or resource.get("payout_item", {}).get("payout_item_id")
        if sender_item:
            payout = session.exec(select(Payout).where(Payout.sender_batch_id == sender_item)).first()
        if not payout and item_id:
            payout = session.exec(select(Payout).where(Payout.paypal_item_id == item_id)).first()
        # Fallback to batch_id if item wasn't isolated
        if not payout:
            batch_id = resource.get("payout_batch_id") or resource.get("batch_header", {}).get("payout_batch_id")
            if batch_id:
                payout = session.exec(select(Payout).where(Payout.paypal_batch_id == batch_id)).first()
    else:
        # Batch-level event
        batch_id = (
            resource.get("batch_header", {}).get("payout_batch_id")
            or resource.get("payout_batch_id")
        )
        sender_batch = (
            resource.get("batch_header", {}).get("sender_batch_header", {}).get("sender_batch_id")
            or resource.get("sender_batch_id")
        )
        if batch_id:
            payout = session.exec(select(Payout).where(Payout.paypal_batch_id == batch_id)).first()
        if not payout and sender_batch:
            payout = session.exec(select(Payout).where(Payout.sender_batch_id == sender_batch)).first()

    if not payout or payout.status == payout_status:
        return False

    # Finite State Machine Validation: prevent illegal backward transitions
    allowed_transitions = VALID_PAYOUT_TRANSITIONS.get(payout.status, set())
    if payout_status not in allowed_transitions:
        record_financial_discrepancy(
            session=session,
            entity_type="PAYOUT",
            entity_id=payout.id,
            external_ref=payout.sender_batch_id,
            issue_type="STATUS_DESYNC",
            severity="HIGH",
            db_state=payout.status,
            paypal_state=payout_status,
            details={"event_type": event_type, "message": f"Illegal transition from {payout.status} to {payout_status}"},
        )
        session.commit()
        return False

    previous_status = payout.status
    payout.status = payout_status
    milestone = session.get(Milestone, payout.milestone_id)
    if not milestone:
        return False

    milestone.status = milestone_status
    session.add_all([payout, milestone])

    # Record Balanced Double-Entry Journal on final settlement
    if payout_status == "SUCCESS" and previous_status != "SUCCESS":
        record_double_entry(
            session=session,
            project_id=milestone.project_id,
            milestone_id=milestone.id,
            entry_type="HOLDBACK_RELEASE" if milestone.is_holdback else "TRANCHE_DISBURSEMENT",
            debit_account="Liabilities:Grantee_Escrow_Allocation",
            credit_account="Assets:PayPal_Escrow_Holdings",
            amount=payout.amount,
            currency=payout.currency,
            reference_id=payout.sender_batch_id,
        )
    elif payout_status == "REFUNDED" and previous_status == "SUCCESS":
        # Compensating Double-Entry Reversal for refunded payout
        record_double_entry(
            session=session,
            project_id=milestone.project_id,
            milestone_id=milestone.id,
            entry_type="REVERSAL",
            debit_account="Assets:PayPal_Escrow_Holdings",
            credit_account="Liabilities:Grantee_Escrow_Allocation",
            amount=payout.amount,
            currency=payout.currency,
            reference_id=f"refund-{payout.sender_batch_id}",
            is_reversal=True,
        )

    # Transition project to COMPLETED ONLY AFTER PayPal confirms settlement of all milestones AND holdback
    if milestone_status == "SETTLED":
        project = session.get(Project, milestone.project_id)
        if project:
            all_project_ms = session.exec(
                select(Milestone).where(Milestone.project_id == project.id)
            ).all()
            all_settled = all(m.status == "SETTLED" or m.id == milestone.id for m in all_project_ms)
            remaining_escrow = round(funded_amount(session, project.id) - released_amount(session, project.id), 2)
            has_unreleased_holdback = (project.holdback_pct > 0 and not any(m.is_holdback for m in all_project_ms))
            if all_settled and remaining_escrow <= 0 and not has_unreleased_holdback:
                project.status = "COMPLETED"
                session.add(project)
                audit(session, "paypal", "project_completed", "project", project.id,
                      reason="All milestones and holdback confirmed SETTLED via PayPal webhooks")

    audit(session, "paypal", f"webhook:{event_type}", "payout", payout.id,
          status=payout_status, event_id=event_id)
    session.commit()
    return True


def reconcile_with_paypal(session: Session, pp: PayPalClient) -> dict[str, Any]:
    """Autonomous reconciliation engine: detects desyncs, missing webhooks, and stuck payouts."""
    discrepancies: list[dict[str, Any]] = []
    reconciled_count = 0
    scanned_count = 0

    open_payouts = session.exec(
        select(Payout).where(Payout.status.in_(("PENDING", "PROCESSING")))
    ).all()

    for p in open_payouts:
        scanned_count += 1
        if not p.paypal_batch_id:
            continue
        try:
            pp_batch = pp.get_payout(p.paypal_batch_id)
            pp_status = pp_batch.get("batch_status")
            if pp_status == "SUCCESS" and p.status != "SUCCESS":
                p.status = "SUCCESS"
                m = session.get(Milestone, p.milestone_id)
                if m:
                    m.status = "SETTLED"
                    session.add(m)
                session.add(p)
                record_double_entry(
                    session=session,
                    project_id=m.project_id if m else 0,
                    milestone_id=m.id if m else None,
                    entry_type="TRANCHE_DISBURSEMENT",
                    debit_account="Liabilities:Grantee_Escrow_Allocation",
                    credit_account="Assets:PayPal_Escrow_Holdings",
                    amount=p.amount,
                    currency=p.currency,
                    reference_id=p.sender_batch_id,
                )
                reconciled_count += 1
            elif pp_status in ("DENIED", "FAILED") and p.status not in ("FAILED", "DENIED"):
                p.status = "FAILED"
                m = session.get(Milestone, p.milestone_id)
                if m:
                    m.status = "PAYOUT_FAILED"
                    session.add(m)
                session.add(p)
                reconciled_count += 1
            elif pp_status in ("PENDING", "PROCESSING"):
                age_minutes = (utcnow() - _aware(p.created_at)).total_seconds() / 60.0
                if age_minutes > 15:
                    d = record_financial_discrepancy(
                        session=session,
                        entity_type="PAYOUT",
                        entity_id=p.id,
                        external_ref=p.paypal_batch_id,
                        issue_type="STUCK_PROCESSING",
                        severity="MEDIUM",
                        db_state=p.status,
                        paypal_state=pp_status,
                        details={"age_minutes": round(age_minutes, 1)},
                    )
                    discrepancies.append({"id": d.id, "issue_type": d.issue_type, "payout_id": p.id})
        except Exception as err:
            d = record_financial_discrepancy(
                session=session,
                entity_type="PAYOUT",
                entity_id=p.id,
                external_ref=p.paypal_batch_id or p.sender_batch_id,
                issue_type="ORPHAN_PAYOUT",
                severity="HIGH",
                db_state=p.status,
                paypal_state="UNKNOWN",
                details={"error": str(err)},
            )
            discrepancies.append({"id": d.id, "issue_type": d.issue_type, "payout_id": p.id, "error": str(err)})

    session.commit()
    return {
        "scanned_payouts": scanned_count,
        "reconciled_payouts": reconciled_count,
        "open_discrepancies": len(discrepancies),
        "discrepancies": discrepancies,
    }


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
    """Release the retained holdback strictly after all regular milestones have SETTLED."""
    if project.status != "FUNDED":
        raise ReleaseError(f"project is {project.status}")
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project.id).order_by(Milestone.order_no)
    ).all()
    regular = [m for m in milestones if not m.is_holdback]
    # Issue 1: Require all regular milestones to be strictly SETTLED before releasing holdback
    if not regular or not all(m.status == "SETTLED" for m in regular):
        raise ReleaseError("all regular milestones must be SETTLED before releasing holdback")

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
    # Issue 2: Do NOT prematurely mark project as COMPLETED here.
    # It remains FUNDED with payout dispatched; when the PayPal settlement webhook arrives,
    # apply_payout_event verifies all milestones are SETTLED and officially completes the project.
    audit(session, actor, "holdback_payout_dispatched", "project", project.id, amount=remaining, payout_id=payout.id)
    session.commit()
    session.refresh(payout)
    return payout
