"""Independent third-party confirmations (vendor, beneficiary, witness).

Only the SHA-256 hash of each invite token is stored in the database. When a confirmation is
submitted, deterministic checks detect denials, amount contradictions, and rehearsed/identical
beneficiary responses across confirmers.
"""
import hashlib
import json
import secrets
from typing import Any

from sqlmodel import Session, select

from app.db.models import Confirmation, Milestone, utcnow
from app.services.release_service import audit
from app.services.similarity import text_jaccard

ALLOWED_KINDS = {"vendor", "beneficiary", "witness"}


class ConfirmationError(Exception):
    pass


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_confirmation_invite(
    session: Session, milestone: Milestone, kind: str, contact_ref: str
) -> tuple[Confirmation, str]:
    if kind not in ALLOWED_KINDS:
        raise ConfirmationError(f"kind must be one of {sorted(ALLOWED_KINDS)}")
    raw_token = secrets.token_urlsafe(24)
    conf = Confirmation(
        milestone_id=milestone.id,
        kind=kind,
        contact_ref=contact_ref.strip()[:200],
        token_hash=_hash_token(raw_token),
    )
    session.add(conf)
    audit(
        session,
        "system",
        "confirmation_invited",
        "milestone",
        milestone.id,
        kind=kind,
        contact_ref=conf.contact_ref,
    )
    session.commit()
    session.refresh(conf)
    return conf, raw_token


def get_confirmation_by_token(session: Session, token: str) -> tuple[Confirmation, Milestone]:
    th = _hash_token(token)
    conf = session.exec(select(Confirmation).where(Confirmation.token_hash == th)).first()
    if not conf:
        raise ConfirmationError("invalid confirmation token")
    milestone = session.get(Milestone, conf.milestone_id)
    if not milestone:
        raise ConfirmationError("milestone not found")
    return conf, milestone


def submit_confirmation(
    session: Session,
    token: str,
    confirmed: bool,
    reported_amount: float | None = None,
    answers: dict[str, Any] | None = None,
    free_text: str = "",
) -> Confirmation:
    conf, milestone = get_confirmation_by_token(session, token)
    if conf.status != "PENDING":
        raise ConfirmationError("confirmation already submitted")

    flags: list[dict[str, Any]] = []
    text = free_text.strip()[:1000]

    if not confirmed:
        flags.append({
            "flag": "DENIED_BY_CONFIRMER",
            "detail": f"{conf.kind} explicitly denied delivery/completion",
        })

    if reported_amount is not None:
        diff = abs(reported_amount - milestone.tranche_amount)
        tolerance = max(5.0, milestone.tranche_amount * 0.15)
        if diff > tolerance:
            flags.append({
                "flag": "REPORTED_AMOUNT_MISMATCH",
                "detail": (f"Confirmer reported {reported_amount:.2f} vs "
                           f"milestone tranche {milestone.tranche_amount:.2f}"),
            })

    # Rehearsed / colluding response detection across confirmers on the same milestone.
    if text and len(text) >= 15:
        siblings = session.exec(
            select(Confirmation).where(
                Confirmation.milestone_id == milestone.id,
                Confirmation.status == "SUBMITTED",
                Confirmation.id != conf.id,
            )
        ).all()
        for other in siblings:
            if not other.free_text:
                continue
            exact = text.lower() == other.free_text.strip().lower()
            sim = text_jaccard(text, other.free_text)
            if exact or sim >= 0.85:
                flags.append({
                    "flag": "REHEARSED_CONFIRMATION",
                    "detail": f"Response wording matches confirmation #{other.id}",
                    "other_confirmation_id": other.id,
                })
                # Retroactively flag the earlier colluding confirmation as well.
                other_flags = json.loads(other.flags_json or "[]")
                if not any(f.get("flag") == "REHEARSED_CONFIRMATION" for f in other_flags):
                    other_flags.append({
                        "flag": "REHEARSED_CONFIRMATION",
                        "detail": f"Response wording matches confirmation #{conf.id}",
                    })
                    other.flags_json = json.dumps(other_flags)
                    other.matched = False
                    session.add(other)

    conf.status = "SUBMITTED"
    conf.confirmed = confirmed
    conf.reported_amount = reported_amount
    conf.answers_json = json.dumps(answers or {})
    conf.free_text = text
    conf.flags_json = json.dumps(flags)
    conf.matched = bool(confirmed and not flags)
    conf.responded_at = utcnow()
    session.add(conf)

    # If a confirmer denied or triggered a rehearsal/contradiction flag, escalate milestone to review.
    if flags and milestone.status not in ("SETTLED", "PAYOUT_SENT"):
        milestone.status = "HUMAN_REVIEW"
        session.add(milestone)

    audit(
        session,
        f"{conf.kind}:{conf.contact_ref}",
        "confirmation_submitted",
        "milestone",
        milestone.id,
        confirmation_id=conf.id,
        confirmed=confirmed,
        matched=conf.matched,
        flags=[f["flag"] for f in flags],
    )
    session.commit()
    session.refresh(conf)
    return conf
