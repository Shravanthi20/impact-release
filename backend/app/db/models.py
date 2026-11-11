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
    email: str = Field(index=True, unique=True)
    password_hash: Optional[str] = None
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
    challenge_window_hours: float = 0.0
    challenge_ends_at: Optional[datetime] = None
    is_holdback: bool = False
    # PENDING -> EVIDENCE_SUBMITTED -> ANALYZED -> CHALLENGE_WINDOW -> APPROVED_FOR_RELEASE -> PAYOUT_SENT -> SETTLED | PAYOUT_FAILED | DISPUTED | HUMAN_REVIEW | REJECTED
    status: str = "PENDING"


class Funding(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    paypal_order_id: str = Field(unique=True, index=True)
    paypal_capture_id: Optional[str] = Field(default=None, unique=True, index=True)
    amount: float
    status: str = "CREATED"  # CREATED | CAPTURED | FAILED
    created_at: datetime = Field(default_factory=utcnow)


class Payout(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id", index=True)
    sender_batch_id: str = Field(index=True, unique=True)
    paypal_batch_id: Optional[str] = Field(default=None, index=True)
    paypal_item_id: Optional[str] = Field(default=None, index=True)
    amount: float
    currency: str = "USD"
    receiver_email: str
    status: str = "PENDING"  # PENDING | PROCESSING | SUCCESS | FAILED | UNCLAIMED | HELD | REFUNDED | CANCELED
    created_at: datetime = Field(default_factory=utcnow)


class JournalEntry(SQLModel, table=True):
    """Immutable double-entry general ledger ensuring every debit has a balanced credit.
    Strictly append-only: corrections are recorded as compensating reversal entries.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    milestone_id: Optional[int] = Field(default=None, foreign_key="milestone.id")
    entry_type: str = Field(index=True)  # ESCROW_DEPOSIT | TRANCHE_DISBURSEMENT | HOLDBACK_RELEASE | REFUND | REVERSAL
    debit_account: str
    credit_account: str
    amount: float
    currency: str = "USD"
    reference_id: str = Field(index=True)  # Order, Capture, or Payout batch/item ID
    is_reversal: bool = False
    reversal_of_id: Optional[int] = Field(default=None, foreign_key="journalentry.id")
    created_at: datetime = Field(default_factory=utcnow)


class WebhookEventRecord(SQLModel, table=True):
    """Guarantees strict deduplication of PayPal webhook events at the database schema level."""
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: str = Field(unique=True, index=True)
    event_type: str = Field(index=True)
    resource_type: str = ""
    status: str = "PROCESSED"  # PROCESSED | FAILED | DUPLICATE
    processed_at: datetime = Field(default_factory=utcnow)


class FinancialDiscrepancy(SQLModel, table=True):
    """Exception queue tracking discrepancies between database state and PayPal API."""
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_type: str = Field(index=True)  # FUNDING | PAYOUT | LEDGER
    entity_id: int = Field(index=True)
    external_ref: str = ""
    issue_type: str  # STUCK_PROCESSING | UNCLAIMED_EXPIRED | AMOUNT_MISMATCH | STATUS_DESYNC | ORPHAN_PAYOUT
    severity: str = "HIGH"  # LOW | MEDIUM | HIGH | CRITICAL
    db_state: str = ""
    paypal_state: str = ""
    details_json: str = "{}"
    status: str = "OPEN"  # OPEN | INVESTIGATING | RESOLVED | WRITTEN_OFF
    created_at: datetime = Field(default_factory=utcnow)
    resolved_at: Optional[datetime] = None


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor: str
    action: str
    entity: str
    entity_id: Optional[int] = None
    details_json: str = "{}"
    created_at: datetime = Field(default_factory=utcnow)


class Challenge(SQLModel, table=True):
    """One-time code the field team must show in the frame (defeats reuse of old photos)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id")
    issued_to: int = Field(foreign_key="user.id")
    code: str
    issued_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    used: bool = False


class Submission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id")
    challenge_id: int = Field(foreign_key="challenge.id")
    submitted_by: int = Field(foreign_key="user.id")
    captured_at: datetime  # client-reported (untrusted)
    received_at: datetime = Field(default_factory=utcnow)  # server time (trusted)
    capture_source: str = "unknown"  # claimed by client: in_app_camera | upload | unknown
    geo_json: str = "{}"
    device_json: str = "{}"
    # SUBMITTED (clean) | FLAGGED (needs review)
    status: str = "SUBMITTED"
    flags_json: str = "[]"


class EvidenceItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: int = Field(foreign_key="submission.id")
    kind: str  # photo | video | document
    filename: str
    content_type: str
    size_bytes: int
    sha256: str = Field(index=True)
    phash: Optional[str] = Field(default=None, index=True)
    extracted_text: str = ""
    stored_path: str


class Analysis(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: int = Field(foreign_key="submission.id", index=True)
    agent: str  # verifier | skeptic
    source: str = "offline"  # llm | offline
    signals_json: str = "{}"
    score: float = 0.0  # verifier: confidence (0..1); skeptic: fraud_risk (0..1)
    explanation: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class Confirmation(SQLModel, table=True):
    """Independent third-party confirmation (vendor, beneficiary, or witness).
    Only the SHA-256 hash of the invite token is stored."""
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id", index=True)
    kind: str  # vendor | beneficiary | witness
    contact_ref: str
    token_hash: str = Field(index=True, unique=True)
    status: str = "PENDING"  # PENDING | SUBMITTED
    confirmed: Optional[bool] = None
    reported_amount: Optional[float] = None
    answers_json: str = "{}"
    free_text: str = ""
    matched: bool = False
    flags_json: str = "[]"
    created_at: datetime = Field(default_factory=utcnow)
    responded_at: Optional[datetime] = None


class ReleaseDecision(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id", index=True)
    decision: str  # release | hold | review | reject
    confidence: float = 0.0
    rules_passed: bool = False
    rules_json: str = "{}"
    explanation: str = ""
    decided_by: str = "agent"  # agent | human
    created_at: datetime = Field(default_factory=utcnow)


class Dispute(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id", index=True)
    raised_by: str
    reason: str
    status: str = "OPEN"  # OPEN | RESOLVED_RELEASE | RESOLVED_REJECT
    created_at: datetime = Field(default_factory=utcnow)


class RiskGraphEdge(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    a_type: str
    a_id: str = Field(index=True)
    b_type: str
    b_id: str = Field(index=True)
    relation: str
    weight: float = 1.0
    created_at: datetime = Field(default_factory=utcnow)
