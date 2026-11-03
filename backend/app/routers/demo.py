"""Seeds a realistic end-to-end showcase dataset for the UI and judges."""
import io
import json

from fastapi import APIRouter, Depends
from PIL import Image, ImageDraw
from sqlmodel import Session, select

from app.db.models import Milestone, Project, User, utcnow
from app.db.session import get_session
from app.services import confirmations as cf
from app.services import evidence as ev
from app.services import release_service as rs
from app.services import verification as vf
from app.services.paypal_client import PayPalClient, get_paypal

router = APIRouter()


def _demo_image(seed: int, size: tuple[int, int], fmt: str, trailer: str) -> bytes:
    base = Image.new("RGB", (120, 120), color=(242, 245, 250))
    draw = ImageDraw.Draw(base)
    for i in range(0, 120, 15):
        color = ((i * 19 + seed * 37) % 255, (i * 11 + seed * 17) % 255, (i * 29) % 255)
        draw.rectangle([i, (i // 2) % 60, i + 10, 110], fill=color)
    img = base.resize(size, Image.Resampling.LANCZOS) if size != (120, 120) else base
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue() + b"\n" + trailer.encode("ascii")


@router.post("/demo/seed")
def seed_demo_data(
    session: Session = Depends(get_session),
    pp: PayPalClient = Depends(get_paypal),
):
    """Create a realistic 3-milestone project showing:
    1) A verified, vendor-confirmed, settled PayPal payout in the Public Ledger.
    2) A milestone caught by the Skeptic Agent for reusing a resized photo (in Reviewer Console).
    3) A milestone with an open beneficiary dispute during the challenge window (in Reviewer Console).
    """
    donor = session.exec(select(User).where(User.email == "donor@demo.impactrelease.org")).first()
    if not donor:
        donor = User(role="donor", name="Asha Foundation (Donor)", email="donor@demo.impactrelease.org")
        session.add(donor)
    ngo = session.exec(select(User).where(User.email == "ngo@demo.impactrelease.org")).first()
    if not ngo:
        ngo = User(
            role="ngo",
            name="Vidya Grassroots Trust (Pune)",
            email="ngo@demo.impactrelease.org",
            paypal_email="vidya-ngo@sandbox.paypal.com",
        )
        session.add(ngo)
    session.commit()
    session.refresh(donor)
    session.refresh(ngo)

    project = Project(
        donor_id=donor.id,
        org_id=ngo.id,
        intent_text="Fund school fees, textbooks, and attendance tracking for 30 girls in Pune",
        total_amount=1000.0,
        currency="USD",
        holdback_pct=10.0,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    reqs = json.dumps([
        "In-app photo or short video showing the one-time challenge code",
        "Itemised receipts matching the milestone tranche",
        "Independent confirmation: vendor confirmation, or confirmations from randomly sampled beneficiaries",
    ])
    m1 = Milestone(
        project_id=project.id,
        order_no=1,
        title="Enrollment & Tuition Fee Disbursement",
        description="Pay school tuition fees for 30 enrolled students.",
        tranche_amount=300.0,
        payee_user_id=ngo.id,
        evidence_requirements_json=reqs,
    )
    m2 = Milestone(
        project_id=project.id,
        order_no=2,
        title="Textbooks & Uniform Procurement",
        description="Purchase and distribute textbooks and school uniforms.",
        tranche_amount=350.0,
        payee_user_id=ngo.id,
        evidence_requirements_json=reqs,
    )
    m3 = Milestone(
        project_id=project.id,
        order_no=3,
        title="Mid-Term Attendance Verification",
        description="Verify 85%+ attendance across the 30 students.",
        tranche_amount=250.0,
        payee_user_id=ngo.id,
        evidence_requirements_json=reqs,
        challenge_window_hours=2.0,
    )
    session.add_all([m1, m2, m3])
    session.commit()
    for m in (m1, m2, m3):
        session.refresh(m)

    # Fund project via PayPal order + capture
    funding = rs.start_funding(session, pp, project)
    rs.capture_funding(session, pp, funding)

    # Milestone 1: clean submission + vendor confirmation -> released & settled via webhook
    ch1 = ev.issue_challenge(session, m1, ngo.id)
    img1 = _demo_image(202, (120, 120), "PNG", f"Challenge {ch1.code} | Receipt Total: $300.00")
    sub1, _ = ev.create_submission(
        session, m1, ch1.id, ngo.id, utcnow(),
        [("tuition_receipt.png", "image/png", img1)],
        capture_source="in_app_camera",
        geo={"lat": 18.5204, "lng": 73.8567, "accuracy_m": 6.0},
    )
    vf.analyze_submission(session, sub1.id)
    _, tok1 = cf.create_confirmation_invite(session, m1, "vendor", "Pune Municipal School Board")
    cf.submit_confirmation(
        session, tok1, confirmed=True, reported_amount=300.0,
        free_text="Confirmed tuition fee receipt for 30 students.",
    )
    rs.evaluate_and_decide_milestone(session, m1)
    payout1 = rs.release_milestone(session, pp, m1, actor="release_agent")
    rs.apply_payout_event(
        session,
        "PAYMENT.PAYOUTSBATCH.SUCCESS",
        {"batch_header": {"payout_batch_id": payout1.paypal_batch_id}},
    )

    # Milestone 2: reuses a resized JPEG of Milestone 1's photo + mismatched receipt -> flagged by Skeptic!
    ch2 = ev.issue_challenge(session, m2, ngo.id)
    img2 = _demo_image(202, (160, 160), "JPEG", f"Challenge {ch2.code} | Receipt Total: $180.00")
    sub2, _ = ev.create_submission(
        session, m2, ch2.id, ngo.id, utcnow(),
        [("uniforms_reused.jpg", "image/jpeg", img2)],
        capture_source="in_app_camera",
        geo={"lat": 18.5204, "lng": 73.8567, "accuracy_m": 8.0},
    )
    vf.analyze_submission(session, sub2.id)

    # Milestone 3: clean submission + vendor confirm -> enters challenge window -> beneficiary raises dispute!
    ch3 = ev.issue_challenge(session, m3, ngo.id)
    img3 = _demo_image(509, (120, 120), "PNG", f"Challenge {ch3.code} | Receipt Total: $250.00")
    sub3, _ = ev.create_submission(
        session, m3, ch3.id, ngo.id, utcnow(),
        [("attendance_register.png", "image/png", img3)],
        capture_source="in_app_camera",
        geo={"lat": 18.5310, "lng": 73.8446, "accuracy_m": 5.0},
    )
    vf.analyze_submission(session, sub3.id)
    _, tok3 = cf.create_confirmation_invite(session, m3, "witness", "Headmistress Deshmukh")
    cf.submit_confirmation(
        session, tok3, confirmed=True, reported_amount=250.0,
        free_text="Attendance register verified for Term 1.",
    )
    rs.evaluate_and_decide_milestone(session, m3)
    rs.raise_dispute(
        session, m3,
        raised_by="Beneficiary Parent Representative",
        reason="5 students in Ward 4 have not yet received their workbook kits.",
    )

    return {
        "seeded": True,
        "donor_id": donor.id,
        "ngo_id": ngo.id,
        "project_id": project.id,
        "milestones": [m1.id, m2.id, m3.id],
    }
