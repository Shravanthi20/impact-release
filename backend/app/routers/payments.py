from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.models import AuditLog, Funding, Milestone, Payout, Project, User
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
        session.add(Milestone(project_id=project.id, order_no=i, **m.model_dump()))
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


# ---------- milestones & payouts ----------
@router.post("/milestones/{milestone_id}/approve")
def approve_milestone(milestone_id: int, body: ApproveIn, session: Session = Depends(get_session)):
    """Phase 1 placeholder: a reviewer approves manually.
    From Phase 5 this status is set only by the verification pipeline and rules engine."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise HTTPException(404, "milestone not found")
    if milestone.status != "PENDING":
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
    changed = rs.apply_payout_event(session, body.get("event_type", ""), body.get("resource", {}))
    return {"ok": True, "changed": changed}


# ---------- ledger & audit ----------
@router.get("/ledger/public")
def public_ledger(session: Session = Depends(get_session)):
    """Anonymised: no emails or names."""
    rows = session.exec(select(Payout, Milestone, Project)
                        .join(Milestone, Milestone.id == Payout.milestone_id)
                        .join(Project, Project.id == Milestone.project_id)
                        .order_by(Payout.id.desc())).all()
    return [{"payout_id": p.id, "project_id": pr.id, "milestone": m.title,
             "amount": p.amount, "currency": p.currency, "status": p.status,
             "created_at": p.created_at} for p, m, pr in rows]


@router.get("/audit")
def audit_log(session: Session = Depends(get_session)):
    return session.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(200)).all()
