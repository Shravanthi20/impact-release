import json

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.models import AuditLog, Funding, JournalEntry, Milestone, Payout, Project, ReleaseDecision, User
from app.db.session import get_session
from app.services import release_service as rs
from app.services.paypal_client import PayPalClient, PayPalError, get_paypal

router = APIRouter()


# ---------- schemas ----------
class UserIn(BaseModel):
    role: str = Field(pattern="^(donor|ngo|vendor|reviewer)$")
    name: str
    email: str
    paypal_email: str | None = None


class MilestoneIn(BaseModel):
    title: str
    description: str = ""
    tranche_amount: float = Field(gt=0)
    payee_user_id: int
    evidence_requirements: list[str] = []
    challenge_window_hours: float = Field(default=0.0, ge=0.0)


class ProjectIn(BaseModel):
    donor_id: int
    org_id: int | None = None
    intent_text: str = ""
    total_amount: float = Field(gt=0)
    currency: str = "USD"
    holdback_pct: float = Field(default=10.0, ge=0, le=50)
    milestones: list[MilestoneIn] = Field(min_length=1)


class ApproveIn(BaseModel):
    actor: str = "reviewer"
    human_approved: bool = False


# ---------- users ----------
@router.post("/users")
def create_user(body: UserIn, session: Session = Depends(get_session)):
    user = User(**body.model_dump())
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.get("/users")
def list_users(session: Session = Depends(get_session)):
    return session.exec(select(User).order_by(User.id)).all()


@router.get("/projects")
def list_projects(session: Session = Depends(get_session)):
    projects = session.exec(select(Project).order_by(Project.id.desc())).all()
    out = []
    for p in projects:
        ms = session.exec(
            select(Milestone).where(Milestone.project_id == p.id).order_by(Milestone.order_no)
        ).all()
        out.append({
            "project": p,
            "milestones": ms,
            "funded": rs.funded_amount(session, p.id),
            "released": rs.released_amount(session, p.id),
        })
    return out


# ---------- projects ----------
@router.post("/projects")
def create_project(body: ProjectIn, session: Session = Depends(get_session)):
    if sum(m.tranche_amount for m in body.milestones) > body.total_amount + 1e-9:
        raise HTTPException(422, "milestone tranches exceed project total")
    for uid in {body.donor_id, *(m.payee_user_id for m in body.milestones)}:
        if not session.get(User, uid):
            raise HTTPException(404, f"user {uid} not found")
    project = Project(**body.model_dump(exclude={"milestones"}))
    session.add(project)
    session.commit()
    session.refresh(project)
    for i, m in enumerate(body.milestones, start=1):
        data = m.model_dump(exclude={"evidence_requirements"})
        session.add(Milestone(project_id=project.id, order_no=i, **data,
                              evidence_requirements_json=json.dumps(m.evidence_requirements)))
    rs.audit(session, "donor", "project_created", "project", project.id)
    session.commit()
    return get_project(project.id, session)


@router.get("/projects/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    milestones = session.exec(select(Milestone).where(Milestone.project_id == project_id)
                              .order_by(Milestone.order_no)).all()
    return {"project": project, "milestones": milestones,
            "funded": rs.funded_amount(session, project_id),
            "released": rs.released_amount(session, project_id)}


@router.post("/projects/{project_id}/fund")
def fund_project(project_id: int, session: Session = Depends(get_session),
                 pp: PayPalClient = Depends(get_paypal)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    try:
        funding = rs.start_funding(session, pp, project)
    except (rs.ReleaseError, PayPalError) as e:
        raise HTTPException(400, str(e))
    return {"funding_id": funding.id, "order_id": funding.paypal_order_id,
            "approve_url": funding.__dict__.get("approve_url")}


@router.post("/projects/{project_id}/fund/capture")
def capture_project_funding(project_id: int, session: Session = Depends(get_session),
                            pp: PayPalClient = Depends(get_paypal)):
    funding = session.exec(select(Funding).where(Funding.project_id == project_id)
                           .order_by(Funding.id.desc())).first()
    if not funding:
        raise HTTPException(404, "no funding order for project")
    try:
        funding = rs.capture_funding(session, pp, funding)
    except (rs.ReleaseError, PayPalError) as e:
        raise HTTPException(400, str(e))
    return funding


@router.get("/funding/return", include_in_schema=False)
def funding_return(
    token: str = Query(default=""),
    PayerID: str | None = Query(default=None),
    session: Session = Depends(get_session),
    pp: PayPalClient = Depends(get_paypal),
):
    """Callback when donor completes PayPal checkout approval in sandbox or live."""
    if not token:
        return RedirectResponse(url="/?payment_error=missing_token")
    funding = session.exec(select(Funding).where(Funding.paypal_order_id == token)).first()
    if not funding:
        return RedirectResponse(url="/?payment_error=order_not_found")
    if funding.status != "CAPTURED":
        try:
            rs.capture_funding(session, pp, funding)
        except Exception as e:
            return RedirectResponse(url=f"/?payment_error={quote(str(e))}")
    return RedirectResponse(url=f"/?funded=true&project_id={funding.project_id}")


@router.get("/funding/cancel", include_in_schema=False)
def funding_cancel(token: str | None = Query(default=None)):
    """Callback when donor cancels PayPal checkout."""
    return RedirectResponse(url="/?payment_cancelled=true")


# ---------- milestones & payouts ----------
@router.post("/milestones/{milestone_id}/approve")
def approve_milestone(milestone_id: int, body: ApproveIn, session: Session = Depends(get_session)):
    """Phase 1 placeholder: a reviewer approves manually.
    From Phase 5 this status is set only by the verification pipeline and rules engine."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise HTTPException(404, "milestone not found")
    if milestone.status not in (
        "PENDING", "EVIDENCE_SUBMITTED", "ANALYZED", "HUMAN_REVIEW"
    ):
        raise HTTPException(409, f"milestone is {milestone.status}")
    milestone.status = "APPROVED_FOR_RELEASE"
    session.add(milestone)
    rs.audit(session, body.actor, "milestone_approved", "milestone", milestone_id)
    session.commit()
    return milestone


@router.post("/payouts/{milestone_id}/execute")
def execute_payout(milestone_id: int, body: ApproveIn, session: Session = Depends(get_session),
                   pp: PayPalClient = Depends(get_paypal)):
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise HTTPException(404, "milestone not found")
    if body.actor.lower() in ("ngo", "payee") or body.actor.lower() == str(milestone.payee_user_id):
        raise HTTPException(403, "grantees/payees cannot approve or execute their own milestone payouts")
    try:
        return rs.release_milestone(session, pp, milestone, body.actor, body.human_approved)
    except rs.ReleaseError as e:
        raise HTTPException(409, str(e))
    except PayPalError as e:
        raise HTTPException(502, str(e))


# ---------- webhooks ----------
@router.post("/webhooks/paypal")
async def paypal_webhook(request: Request, session: Session = Depends(get_session),
                         pp: PayPalClient = Depends(get_paypal)):
    body = await request.json()
    if not pp.verify_webhook(dict(request.headers), body):
        raise HTTPException(400, "invalid webhook signature")
    event_id = body.get("id")
    changed = rs.apply_payout_event(
        session, body.get("event_type", ""), body.get("resource", {}), event_id=event_id
    )
    return {"ok": True, "changed": changed}


# ---------- ledger & audit ----------
@router.get("/ledger/journal")
def double_entry_journal(project_id: int | None = None, session: Session = Depends(get_session)):
    """Balanced double-entry journal ledger displaying immutable debit and credit pairs."""
    query = select(JournalEntry)
    if project_id:
        query = query.where(JournalEntry.project_id == project_id)
    return session.exec(query.order_by(JournalEntry.id.desc())).all()


@router.get("/ledger/journal/verify")
def verify_journal(project_id: int | None = None, session: Session = Depends(get_session)):
    """Audit verification endpoint confirming total debits equal total credits."""
    return rs.verify_double_entry_balance(session, project_id=project_id)


@router.post("/reconciliation/run")
def run_reconciliation(session: Session = Depends(get_session), pp: PayPalClient = Depends(get_paypal)):
    """Run automated reconciliation between PostgreSQL database and PayPal API."""
    return rs.reconcile_with_paypal(session, pp)


@router.get("/reconciliation/discrepancies")
def get_discrepancies(session: Session = Depends(get_session)):
    """Exception queue displaying financial desyncs, stuck processing batches, and orphan payouts."""
    from app.db.models import FinancialDiscrepancy
    return session.exec(select(FinancialDiscrepancy).order_by(FinancialDiscrepancy.id.desc())).all()
@router.get("/ledger/public")
def public_ledger(session: Session = Depends(get_session)):
    """Anonymised: no emails or names."""
    rows = session.exec(select(Payout, Milestone, Project)
                        .join(Milestone, Milestone.id == Payout.milestone_id)
                        .join(Project, Project.id == Milestone.project_id)
                        .order_by(Payout.id.desc())).all()
    out = []
    for p, m, pr in rows:
        dec = session.exec(
            select(ReleaseDecision)
            .where(ReleaseDecision.milestone_id == m.id)
            .order_by(ReleaseDecision.id.desc())
        ).first()
        out.append({
            "payout_id": p.id,
            "project_id": pr.id,
            "milestone": m.title,
            "is_holdback": m.is_holdback,
            "amount": p.amount,
            "currency": p.currency,
            "status": p.status,
            "reason": dec.explanation if dec else "Verified milestone release",
            "created_at": p.created_at,
        })
    return out


def _humanize_audit(
    row: AuditLog,
    users: dict[int, User],
    projects: dict[int, Project],
    milestones: dict[int, Milestone],
) -> dict:
    details = {}
    try:
        details = json.loads(row.details_json or "{}")
    except ValueError:
        pass

    # Resolve human-friendly actor name
    actor = row.actor
    if actor.startswith("user:"):
        uid = int(actor.split(":", 1)[1]) if actor.split(":", 1)[1].isdigit() else -1
        u = users.get(uid)
        actor_label = f"{u.name} ({u.role.upper()})" if u else f"User #{uid}"
    elif actor in ("donor", "ngo", "reviewer"):
        actor_label = actor.capitalize()
    elif actor.startswith("release_agent"):
        actor_label = "Release Decision Agent"
    elif actor == "paypal":
        actor_label = "PayPal Webhook"
    elif actor == "system":
        actor_label = "ImpactRelease System"
    elif ":" in actor:
        kind, ref = actor.split(":", 1)
        actor_label = f"{ref} ({kind.capitalize()})"
    else:
        actor_label = actor

    # Resolve human-friendly target entity name
    if row.entity == "project" and row.entity_id in projects:
        p = projects[row.entity_id]
        entity_label = f"Grant #{p.id} (${p.total_amount:,.2f})"
    elif row.entity == "milestone" and row.entity_id in milestones:
        m = milestones[row.entity_id]
        entity_label = f"Milestone #{m.order_no}: {m.title}"
    elif row.entity_id is not None:
        entity_label = f"{row.entity.capitalize()} #{row.entity_id}"
    else:
        entity_label = row.entity.capitalize()

    action = row.action
    category = "System"
    severity = "info"
    event_title = action.replace("_", " ").title()
    summary = ""

    if action == "project_created":
        category = "Grant Setup"
        event_title = "Grant Contract Created"
        summary = f"Created milestone-based grant contract for {entity_label}."
    elif action == "funding_order_created":
        category = "PayPal Funding"
        event_title = "PayPal Order Initiated"
        summary = f"Created PayPal funding order ({details.get('order_id', 'N/A')})."
    elif action == "funding_captured":
        category = "PayPal Funding"
        severity = "ok"
        event_title = "Grant Funds Captured"
        summary = f"PayPal payment captured into grant balance (Ref: {details.get('capture_id', 'N/A')})."
    elif action == "challenge_issued":
        category = "Field Evidence"
        event_title = "Verification Code Issued"
        summary = f"Generated a single-use 6-digit camera verification code for {entity_label}."
    elif action == "evidence_submitted":
        category = "Field Evidence"
        flags = details.get("flags") or []
        severity = "warn" if flags else "ok"
        event_title = "Field Evidence Uploaded"
        flag_txt = f" — Flagged: {', '.join(flags)}" if flags else " — Passed capture checks"
        summary = f"Uploaded {details.get('files', 1)} evidence file(s) (Submission #{details.get('submission_id')}){flag_txt}."
    elif action == "submission_analyzed":
        category = "AI Verification"
        rec = str(details.get("skeptic_recommendation", "")).upper()
        risk = int(round(float(details.get("skeptic_risk", 0)) * 100))
        conf = int(round(float(details.get("verifier_confidence", 0)) * 100))
        code_ok = "visible" if details.get("challenge_code_visible") else "missing"
        severity = "ok" if rec == "PASS" else ("err" if rec == "HOLD" else "warn")
        event_title = "AI Verifier & Skeptic Inspection"
        summary = (
            f"Verifier confidence {conf}% (challenge code {code_ok}); "
            f"Skeptic fraud risk {risk}% ({rec}) → Status: {details.get('milestone_status')}."
        )
    elif action == "confirmation_invited":
        category = "Third-Party Proof"
        event_title = "Verification Link Sent"
        summary = f"Invited {details.get('kind', 'verifier')} '{details.get('contact_ref', '')}' to independently confirm delivery."
    elif action == "confirmation_submitted":
        category = "Third-Party Proof"
        matched = details.get("matched", False)
        flags = details.get("flags") or []
        severity = "ok" if matched else "err"
        event_title = "Third-Party Confirmation Received"
        summary = (
            "Independent confirmer verified delivery matching milestone terms."
            if matched
            else f"Confirmation flagged ({', '.join(flags) or 'Denied'}) — Routed to Compliance Review."
        )
    elif action == "release_evaluated":
        category = "Release Engine"
        passed = details.get("rules_passed", False)
        severity = "ok" if passed else "warn"
        event_title = "Release Rules Evaluated"
        summary = (
            f"Decision: {str(details.get('decision', '')).upper()} "
            f"({'All 6 hard rules passed' if passed else 'Unmet verification criteria'}) "
            f"→ {details.get('milestone_status')}."
        )
    elif action == "payout_created":
        category = "PayPal Payout"
        severity = "ok"
        event_title = "PayPal Payout Disbursed"
        summary = (
            f"Disbursed ${float(details.get('amount', 0)):,.2f} via PayPal Payouts "
            f"(Batch: {details.get('batch_id', 'N/A')})."
        )
    elif action.startswith("webhook:"):
        category = "PayPal Webhook"
        st = details.get("status", "")
        severity = "ok" if st == "SUCCESS" else "err"
        event_title = f"PayPal Event: {action.replace('webhook:', '')}"
        summary = f"PayPal updated payout batch status to {st}."
    elif action == "dispute_raised":
        category = "Dispute"
        severity = "err"
        event_title = "Delivery Dispute Filed"
        summary = f"Dispute filed on {entity_label}: \"{details.get('reason', '')}\""
    elif action.startswith("human_review_"):
        category = "Compliance Review"
        approved = action.endswith("approve")
        severity = "ok" if approved else "err"
        event_title = "Auditor Review Decision"
        summary = f"Auditor {'approved' if approved else 'rejected'} milestone: {details.get('comment', '')}"
    elif action == "holdback_released":
        category = "PayPal Payout"
        severity = "ok"
        event_title = "Retention Holdback Released"
        summary = f"Released final ${float(details.get('amount', 0)):,.2f} retention holdback upon grant completion."
    else:
        summary = row.details_json

    return {
        "id": row.id,
        "actor": row.actor,
        "actor_label": actor_label,
        "action": row.action,
        "event_title": event_title,
        "category": category,
        "severity": severity,
        "entity": row.entity,
        "entity_id": row.entity_id,
        "entity_label": entity_label,
        "summary": summary,
        "details_json": row.details_json,
        "created_at": row.created_at,
    }


@router.get("/audit")
def audit_log(session: Session = Depends(get_session)):
    rows = session.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(200)).all()
    users = {u.id: u for u in session.exec(select(User)).all() if u.id is not None}
    projects = {p.id: p for p in session.exec(select(Project)).all() if p.id is not None}
    milestones = {m.id: m for m in session.exec(select(Milestone)).all() if m.id is not None}
    return [_humanize_audit(r, users, projects, milestones) for r in rows]
