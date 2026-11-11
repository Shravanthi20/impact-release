from datetime import datetime, timedelta, timezone

import pytest

from app.services import release_service as rs
from tests.test_phase1_payments import fund
from tests.test_phase4_verification import make_test_image


def create_funded_project(client, donor, ngo, tranches=(400, 500), total=1000, window_hours=0.0):
    r = client.post(
        "/projects",
        json={
            "donor_id": donor["id"],
            "org_id": ngo["id"],
            "intent_text": "School fees and uniforms",
            "total_amount": total,
            "holdback_pct": 10.0,
            "milestones": [
                {
                    "title": f"Milestone {i}",
                    "tranche_amount": t,
                    "payee_user_id": ngo["id"],
                    "challenge_window_hours": window_hours,
                }
                for i, t in enumerate(tranches, 1)
            ],
        },
    )
    assert r.status_code == 200, r.text
    p = r.json()
    fund(client, p["project"]["id"])
    return p


def submit_and_verify_clean(client, mid, uid, amount):
    ch = client.post(f"/milestones/{mid}/challenge", json={"user_id": uid}).json()
    img = make_test_image(
        seed=mid * 13 + 7,
        metadata_text=f"Challenge {ch['code']} | Receipt Total: ${amount:.2f}",
    )
    sub = client.post(
        f"/milestones/{mid}/submissions",
        data={
            "challenge_id": ch["challenge_id"],
            "submitted_by": uid,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
        },
        files=[("files", (f"m{mid}.png", img, "image/png"))],
    ).json()
    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    assert res["verifier"]["challenge_code_visible"] is True
    return res


def test_release_blocked_without_independent_confirmation(client, seeded):
    donor, ngo = seeded
    p = create_funded_project(client, donor, ngo)
    m1 = p["milestones"][0]["id"]
    submit_and_verify_clean(client, m1, ngo["id"], 400)

    dec = client.post(f"/milestones/{m1}/decision").json()
    assert dec["rules_passed"] is False
    assert dec["rules"]["checks"]["independent_confirmation_met"]["passed"] is False
    assert dec["decision"] == "needs_more_evidence"
    assert client.post(f"/payouts/{m1}/execute", json={}).status_code == 409


def test_vendor_confirmation_enables_release_and_explained_public_ledger(client, seeded):
    donor, ngo = seeded
    p = create_funded_project(client, donor, ngo)
    m1 = p["milestones"][0]["id"]
    submit_and_verify_clean(client, m1, ngo["id"], 400)

    inv = client.post(
        f"/milestones/{m1}/confirmations/invite",
        json={"kind": "vendor", "contact_ref": "supplier@schoolbooks.test"},
    ).json()
    prompt = client.get(f"/confirm/{inv['token']}").json()
    assert prompt["kind"] == "vendor" and len(prompt["questions"]) == 2

    conf = client.post(
        f"/confirm/{inv['token']}",
        json={
            "confirmed": True,
            "reported_amount": 400.0,
            "free_text": "Delivered 30 uniform sets on Tuesday.",
        },
    ).json()
    assert conf["matched"] is True

    # Single-use token cannot be submitted twice
    assert (
        client.post(f"/confirm/{inv['token']}", json={"confirmed": True}).status_code == 409
    )

    dec = client.post(f"/milestones/{m1}/decision").json()
    assert dec["rules_passed"] is True
    assert dec["decision"] == "release"
    assert dec["milestone_status"] == "APPROVED_FOR_RELEASE"

    payout = client.post(f"/payouts/{m1}/execute", json={}).json()
    assert payout["amount"] == 400.0

    ledger = client.get("/ledger/public").json()
    assert ledger[0]["payout_id"] == payout["id"]
    assert "All verification checks passed" in ledger[0]["reason"]


def test_beneficiary_minimum_count_and_rehearsed_reply_detection(client, seeded):
    donor, ngo = seeded
    p = create_funded_project(client, donor, ngo)
    m1, m2 = p["milestones"][0]["id"], p["milestones"][1]["id"]
    submit_and_verify_clean(client, m1, ngo["id"], 400)

    # 1 beneficiary confirmation is not enough (default min is 2)
    b1 = client.post(
        f"/milestones/{m1}/confirmations/invite",
        json={"kind": "beneficiary", "contact_ref": "parent-1"},
    ).json()
    client.post(
        f"/confirm/{b1['token']}",
        json={"confirmed": True, "free_text": "My daughter received the books on Monday morning."},
    )
    assert client.post(f"/milestones/{m1}/decision").json()["rules_passed"] is False

    # 2nd distinct beneficiary confirmation satisfies the rule
    b2 = client.post(
        f"/milestones/{m1}/confirmations/invite",
        json={"kind": "beneficiary", "contact_ref": "parent-2"},
    ).json()
    client.post(
        f"/confirm/{b2['token']}",
        json={"confirmed": True, "free_text": "School fee receipt was given to us on Wednesday."},
    )
    assert client.post(f"/milestones/{m1}/decision").json()["rules_passed"] is True

    # On m2, two confirmers submit rehearsed/identical text -> flagged!
    submit_and_verify_clean(client, m2, ngo["id"], 500)
    c1 = client.post(
        f"/milestones/{m2}/confirmations/invite",
        json={"kind": "beneficiary", "contact_ref": "parent-3"},
    ).json()
    c2 = client.post(
        f"/milestones/{m2}/confirmations/invite",
        json={"kind": "beneficiary", "contact_ref": "parent-4"},
    ).json()
    scripted = "Everything was delivered properly on the fifth of November as promised by the team."
    client.post(f"/confirm/{c1['token']}", json={"confirmed": True, "free_text": scripted})
    r2 = client.post(
        f"/confirm/{c2['token']}", json={"confirmed": True, "free_text": scripted}
    ).json()
    assert r2["matched"] is False
    assert any(f["flag"] == "REHEARSED_CONFIRMATION" for f in r2["flags"])

    dec2 = client.post(f"/milestones/{m2}/decision").json()
    assert dec2["rules_passed"] is False
    assert dec2["decision"] == "review"
    assert dec2["milestone_status"] == "HUMAN_REVIEW"


def test_challenge_window_dispute_and_human_review_resolution(client, seeded, monkeypatch):
    donor, ngo = seeded
    p = create_funded_project(client, donor, ngo, window_hours=2.0)
    m1 = p["milestones"][0]["id"]
    submit_and_verify_clean(client, m1, ngo["id"], 400)

    inv = client.post(
        f"/milestones/{m1}/confirmations/invite",
        json={"kind": "vendor", "contact_ref": "vendor-1"},
    ).json()
    client.post(f"/confirm/{inv['token']}", json={"confirmed": True, "reported_amount": 400})

    dec = client.post(f"/milestones/{m1}/decision").json()
    assert dec["milestone_status"] == "CHALLENGE_WINDOW"

    # Payout blocked while challenge window is active
    r_early = client.post(f"/payouts/{m1}/execute", json={})
    assert r_early.status_code == 409 and "challenge window" in r_early.json()["detail"]

    # Beneficiary raises a dispute during the challenge window
    disp = client.post(
        f"/milestones/{m1}/dispute",
        json={"raised_by": "beneficiary-parent", "reason": "Only half the uniforms arrived"},
    ).json()
    assert disp["milestone_status"] == "DISPUTED"

    # Review queue includes the disputed milestone
    q = client.get("/review/queue").json()
    assert any(item["milestone_id"] == m1 and len(item["open_disputes"]) == 1 for item in q)

    # Even after challenge window time passes, open dispute blocks payout
    real_now = rs.utcnow
    monkeypatch.setattr(rs, "utcnow", lambda: real_now() + timedelta(hours=3))
    assert client.post(f"/payouts/{m1}/execute", json={}).status_code == 409

    # Human reviewer investigates and approves release
    rev = client.post(
        f"/review/{m1}/decision",
        json={"reviewer": "auditor-1", "decision": "approve", "comment": "Remaining items delivered"},
    ).json()
    assert rev["milestone_status"] == "APPROVED_FOR_RELEASE"
    assert client.post(f"/payouts/{m1}/execute", json={}).status_code == 200


def test_retention_holdback_released_only_after_all_regular_milestones_settled(client, seeded):
    donor, ngo = seeded
    p = create_funded_project(client, donor, ngo, tranches=(400, 500), total=1000)
    pid = p["project"]["id"]
    m1, m2 = p["milestones"][0]["id"], p["milestones"][1]["id"]

    # Holdback blocked while milestones are still pending
    assert client.post(f"/projects/{pid}/release-holdback", json={}).status_code == 409

    for mid, amt in ((m1, 400), (m2, 500)):
        submit_and_verify_clean(client, mid, ngo["id"], amt)
        inv = client.post(
            f"/milestones/{mid}/confirmations/invite",
            json={"kind": "vendor", "contact_ref": f"v-{mid}"},
        ).json()
        client.post(f"/confirm/{inv['token']}", json={"confirmed": True, "reported_amount": amt})
        client.post(f"/milestones/{mid}/decision")
        p_exec = client.post(f"/payouts/{mid}/execute", json={}).json()
        # Holdback release is blocked while milestone is merely PAYOUT_SENT (not settled)
        assert client.post(f"/projects/{pid}/release-holdback", json={}).status_code == 409
        # Webhook confirms settlement
        client.post(
            "/webhooks/paypal",
            json={
                "event_type": "PAYMENT.PAYOUTSBATCH.SUCCESS",
                "resource": {"payout_batch_id": p_exec["paypal_batch_id"]},
            },
        )

    # Release the 10% ($100) holdback
    hb = client.post(f"/projects/{pid}/release-holdback", json={"actor": "auditor"}).json()
    assert hb["amount"] == 100.0
    # Project is not prematurely marked COMPLETED while holdback payout is pending settlement
    proj_pending = client.get(f"/projects/{pid}").json()
    assert proj_pending["project"]["status"] == "FUNDED"

    # Webhook settles the final holdback payout
    client.post(
        "/webhooks/paypal",
        json={
            "event_type": "PAYMENT.PAYOUTSBATCH.SUCCESS",
            "resource": {"payout_batch_id": hb["paypal_batch_id"]},
        },
    )

    proj = client.get(f"/projects/{pid}").json()
    assert proj["project"]["status"] == "COMPLETED"
    assert proj["released"] == 1000.0

    # Double-entry ledger verification
    verify = client.get(f"/ledger/journal/verify?project_id={pid}").json()
    assert verify["is_balanced"] is True
    assert verify["total_debits"] == verify["total_credits"] == 2000.0
    assert verify["accounts"]["Assets:PayPal_Escrow_Holdings"] == 0.0
    assert verify["accounts"]["Liabilities:Grantee_Escrow_Allocation"] == 0.0
