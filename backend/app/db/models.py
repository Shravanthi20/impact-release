"""Database models (Phase 1 subset of the full data model in the build plan)."""
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    role: str  # donor | ngo | vendor | reviewer
    name: str
    email: str
    paypal_email: Optional[str] = None
    trust_tier: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    donor_id: int = Field(foreign_key="user.id")
    org_id: Optional[int] = Field(default=None, foreign_key="user.id")
    intent_text: str = ""
    total_amount: float
    currency: str = "USD"
    # DRAFT -> FUNDED -> COMPLETED | CANCELLED
    status: str = "DRAFT"
    holdback_pct: float = 10.0
    created_at: datetime = Field(default_factory=utcnow)


class Milestone(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    order_no: int = 1
    title: str
    description: str = ""
    tranche_amount: float
    payee_user_id: int = Field(foreign_key="user.id")
    evidence_requirements_json: str = "[]"
    # PENDING -> APPROVED_FOR_RELEASE -> PAYOUT_SENT -> SETTLED | PAYOUT_FAILED
    status: str = "PENDING"


class Funding(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    paypal_order_id: str
    paypal_capture_id: Optional[str] = None
    amount: float
    status: str = "CREATED"  # CREATED | CAPTURED | FAILED
    created_at: datetime = Field(default_factory=utcnow)


class Payout(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id")
    sender_batch_id: str = Field(index=True, unique=True)
    paypal_batch_id: Optional[str] = None
    amount: float
    currency: str = "USD"
    receiver_email: str
    status: str = "PENDING"  # PENDING | SUCCESS | FAILED | UNCLAIMED
    created_at: datetime = Field(default_factory=utcnow)


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor: str
    action: str
    entity: str
    entity_id: Optional[int] = None
    details_json: str = "{}"
    created_at: datetime = Field(default_factory=utcnow)
