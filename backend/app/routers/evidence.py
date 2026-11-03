import json
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import settings
from app.db.models import EvidenceItem, Milestone, Submission
from app.db.session import get_session
from app.services import evidence as ev
from app.services import verification as vf

router = APIRouter()


class ChallengeIn(BaseModel):
    user_id: int


def _milestone(session: Session, milestone_id: int) -> Milestone:
    m = session.get(Milestone, milestone_id)
    if not m:
        raise HTTPException(404, "milestone not found")
    return m


@router.post("/milestones/{milestone_id}/challenge")
def request_challenge(milestone_id: int, body: ChallengeIn, session: Session = Depends(get_session)):
    """Issue a one-time code the field team must show in the photo or video."""
    try:
        c = ev.issue_challenge(session, _milestone(session, milestone_id), body.user_id)
    except ev.EvidenceError as e:
        raise HTTPException(409, str(e))
    return {"challenge_id": c.id, "code": c.code, "expires_at": c.expires_at}


@router.post("/milestones/{milestone_id}/submissions")
async def submit_evidence(
    milestone_id: int,
    challenge_id: int = Form(...),
    submitted_by: int = Form(...),
    captured_at: datetime = Form(...),
    capture_source: str = Form("unknown"),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    accuracy_m: float | None = Form(None),
    device: str = Form("{}"),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    try:
        device_info = json.loads(device)
        if not isinstance(device_info, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(422, "device must be a JSON object")
    limit = settings.max_upload_mb * 1024 * 1024
    blobs = []
    for f in files:
        data = await f.read(limit + 1)  # never buffer more than limit+1 bytes
        blobs.append((f.filename or "upload", f.content_type or "", data))
    geo = {"lat": lat, "lng": lng, "accuracy_m": accuracy_m} if lat is not None and lng is not None else {}
    try:
        sub, items = ev.create_submission(session, _milestone(session, milestone_id), challenge_id,
                                          submitted_by, captured_at, blobs, capture_source, geo,
                                          device_info)
    except ev.EvidenceError as e:
        raise HTTPException(422, str(e))
    return {"submission_id": sub.id, "status": sub.status, "flags": json.loads(sub.flags_json),
            "files": [{"filename": i.filename, "sha256": i.sha256, "phash": i.phash,
                       "kind": i.kind} for i in items]}


@router.get("/milestones/{milestone_id}/submissions")
def list_submissions(milestone_id: int, session: Session = Depends(get_session)):
    _milestone(session, milestone_id)
    subs = session.exec(select(Submission).where(Submission.milestone_id == milestone_id)
                        .order_by(Submission.id)).all()
    out = []
    for s in subs:
        items = session.exec(select(EvidenceItem).where(EvidenceItem.submission_id == s.id)).all()
        out.append({"id": s.id, "status": s.status, "flags": json.loads(s.flags_json),
                    "captured_at": s.captured_at, "received_at": s.received_at,
                    "capture_source": s.capture_source, "geo": json.loads(s.geo_json),
                    "files": [{"filename": i.filename, "sha256": i.sha256, "phash": i.phash,
                               "kind": i.kind, "size_bytes": i.size_bytes} for i in items]})
    return out


@router.post("/submissions/{submission_id}/analyze")
def run_submission_analysis(submission_id: int, session: Session = Depends(get_session)):
    """Run the Verifier agent, similarity search, and Skeptic agent on a submission."""
    try:
        return vf.analyze_submission(session, submission_id)
    except vf.VerificationError as e:
        raise HTTPException(404, str(e))


@router.get("/submissions/{submission_id}/analysis")
def get_submission_analysis(submission_id: int, session: Session = Depends(get_session)):
    """Fetch stored Verifier + Skeptic analyses (running them first if not yet analyzed)."""
    try:
        return vf.get_submission_analysis(session, submission_id)
    except vf.VerificationError as e:
        raise HTTPException(404, str(e))
