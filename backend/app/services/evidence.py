"""Evidence capture: one-time challenge codes, submission validation, hashing, duplicate flags.

Honest limits: the server cannot prove a photo came from the in-app camera, or that GPS and device
data are real. ``capture_source``, geo and device fields are CLAIMS stored for later cross-checks.
What the server can enforce: the challenge code is single-use and time-boxed, the claimed capture
time fits the window, the file is an allowed type and size, and byte-identical files are detected.
Whether the code is actually visible in the image is checked by the verifier agent (Phase 4).
"""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlmodel import Session, select

from app.config import settings
from app.db.models import Challenge, EvidenceItem, Milestone, Project, Submission, utcnow
from app.services.release_service import audit

ALLOWED_TYPES = {
    "image/jpeg": "photo", "image/png": "photo", "image/webp": "photo",
    "video/mp4": "video", "video/webm": "video", "application/pdf": "document",
}


class EvidenceError(Exception):
    pass


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def issue_challenge(session: Session, milestone: Milestone, user_id: int) -> Challenge:
    project = session.get(Project, milestone.project_id)
    if project.status != "FUNDED":
        raise EvidenceError("project is not funded")
    if user_id != milestone.payee_user_id:
        raise EvidenceError("only the milestone payee can request a challenge")
    if milestone.status not in ("PENDING", "EVIDENCE_SUBMITTED"):
        raise EvidenceError(f"milestone is {milestone.status}")
    now = utcnow()
    challenge = Challenge(milestone_id=milestone.id, issued_to=user_id,
                          code=f"{secrets.randbelow(10**6):06d}", issued_at=now,
                          expires_at=now + timedelta(minutes=settings.challenge_ttl_minutes))
    session.add(challenge)
    audit(session, f"user:{user_id}", "challenge_issued", "milestone", milestone.id)
    session.commit()
    session.refresh(challenge)
    return challenge


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def create_submission(session: Session, milestone: Milestone, challenge_id: int, user_id: int,
                      captured_at: datetime, files: list[tuple[str, str, bytes]],
                      capture_source: str = "unknown", geo: dict | None = None,
                      device: dict | None = None) -> tuple[Submission, list[EvidenceItem]]:
    """files: list of (filename, content_type, bytes). Raises EvidenceError on hard failures;
    suspicious-but-acceptable evidence is stored with flags for review."""
    challenge = session.get(Challenge, challenge_id)
    if not challenge or challenge.milestone_id != milestone.id:
        raise EvidenceError("unknown challenge for this milestone")
    if user_id != milestone.payee_user_id or challenge.issued_to != user_id:
        raise EvidenceError("submitter is not the payee this challenge was issued to")
    if challenge.used:
        raise EvidenceError("challenge already used")
    now = utcnow()
    skew = timedelta(seconds=settings.clock_skew_seconds)
    if now > _aware(challenge.expires_at) + skew:
        raise EvidenceError("challenge expired")
    if not files:
        raise EvidenceError("at least one file is required")

    flags: list[dict] = []
    cap = _aware(captured_at)
    if cap < _aware(challenge.issued_at) - skew:
        raise EvidenceError("capture time is before the challenge was issued")
    if cap > _aware(challenge.expires_at) + skew:
        raise EvidenceError("capture time is after the challenge expired")
    if cap > now + skew:
        raise EvidenceError("capture time is in the future")
    if capture_source != "in_app_camera":
        flags.append({"flag": "NOT_IN_APP_CAPTURE",
                      "detail": f"client reported capture_source={capture_source!r}"})

    max_bytes = settings.max_upload_mb * 1024 * 1024
    prepared = []
    seen_in_batch = set()
    for name, ctype, data in files:
        if ctype not in ALLOWED_TYPES:
            raise EvidenceError(f"file type not allowed: {ctype}")
        if not data:
            raise EvidenceError(f"empty file: {name}")
        if len(data) > max_bytes:
            raise EvidenceError(f"file too large: {name}")
        digest = sha256_hex(data)
        if digest in seen_in_batch:
            flags.append({"flag": "DUPLICATE_IN_SUBMISSION", "detail": name})
        seen_in_batch.add(digest)
        prior = session.exec(select(EvidenceItem).where(EvidenceItem.sha256 == digest)).first()
        if prior:
            flags.append({"flag": "DUPLICATE_FILE_REUSED", "detail": name,
                          "earlier_submission_id": prior.submission_id})
        prepared.append((name, ctype, data, digest))

    submission = Submission(
        milestone_id=milestone.id, challenge_id=challenge.id, submitted_by=user_id,
        captured_at=cap, received_at=now, capture_source=capture_source,
        geo_json=json.dumps(geo or {}), device_json=json.dumps(device or {}),
        status="FLAGGED" if flags else "SUBMITTED", flags_json=json.dumps(flags))
    session.add(submission)
    session.flush()

    out_dir = Path(settings.evidence_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for name, ctype, data, digest in prepared:
        path = out_dir / digest  # content-addressed: filename never taken from the client
        if not path.exists():
            path.write_bytes(data)
        item = EvidenceItem(submission_id=submission.id, kind=ALLOWED_TYPES[ctype],
                            filename=Path(name).name[:200], content_type=ctype,
                            size_bytes=len(data), sha256=digest, stored_path=str(path))
        session.add(item)
        items.append(item)

    challenge.used = True
    milestone.status = "EVIDENCE_SUBMITTED"
    session.add_all([challenge, milestone])
    audit(session, f"user:{user_id}", "evidence_submitted", "milestone", milestone.id,
          submission_id=submission.id, files=len(items), flags=[f["flag"] for f in flags])
    session.commit()
    session.refresh(submission)
    return submission, items
