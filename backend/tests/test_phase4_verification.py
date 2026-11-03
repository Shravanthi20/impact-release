import io
from datetime import datetime, timezone

import pytest
from PIL import Image, ImageDraw

from app.agents import llm
from app.config import settings
from tests.test_phase1_payments import fund, make_project


def make_test_image(
    seed: int = 1, size: tuple[int, int] = (120, 120), fmt: str = "PNG", metadata_text: str = ""
) -> bytes:
    """Create a deterministic patterned image (scaled to ``size``) so perceptual dHash is meaningful."""
    base = Image.new("RGB", (120, 120), color=(240, 240, 240))
    draw = ImageDraw.Draw(base)
    for i in range(0, 120, 15):
        color = ((i * 17 + seed * 31) % 255, (i * 9 + seed * 13) % 255, (i * 23) % 255)
        draw.rectangle([i, (i // 2) % 60, i + 10, 110], fill=color)
    img = base.resize(size, Image.Resampling.LANCZOS) if size != (120, 120) else base
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    raw = buf.getvalue()
    if metadata_text:
        # Append printable ASCII trailer so the offline verifier can also inspect text/codes
        raw += b"\n" + metadata_text.encode("ascii")
    return raw


@pytest.fixture()
def funded_pair(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo, tranches=(100, 200), total=1000)
    fund(client, p["project"]["id"])
    return ngo, p["milestones"][0]["id"], p["milestones"][1]["id"]


def issue_and_submit(client, mid, uid, img_bytes, ctype="image/png", name="proof.png"):
    ch = client.post(f"/milestones/{mid}/challenge", json={"user_id": uid}).json()
    r = client.post(
        f"/milestones/{mid}/submissions",
        data={
            "challenge_id": ch["challenge_id"],
            "submitted_by": uid,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
            "device": '{"model": "pixel"}',
        },
        files=[("files", (name, img_bytes, ctype))],
    )
    assert r.status_code == 200, r.text
    return ch, r.json()


def test_valid_submission_with_challenge_code_verifies_cleanly(client, funded_pair):
    ngo, m1, _ = funded_pair
    ch = client.post(f"/milestones/{m1}/challenge", json={"user_id": ngo["id"]}).json()
    img = make_test_image(seed=10, metadata_text=f"Challenge {ch['code']} | Receipt Total: $100.00")
    sub = client.post(
        f"/milestones/{m1}/submissions",
        data={
            "challenge_id": ch["challenge_id"],
            "submitted_by": ngo["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
        },
        files=[("files", ("classroom.png", img, "image/png"))],
    ).json()
    assert sub["files"][0]["phash"] is not None

    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    assert res["verifier"]["challenge_code_visible"] is True
    assert res["verifier"]["claimed_amount_on_receipt"] == 100.0
    assert res["skeptic"]["recommendation"] == "pass"
    assert res["submission_status"] == "VERIFIED"
    assert res["milestone_status"] == "ANALYZED"

    # GET endpoint returns the stored analysis
    fetched = client.get(f"/submissions/{sub['submission_id']}/analysis").json()
    assert fetched["verifier"]["challenge_code_visible"] is True


def test_missing_challenge_code_triggers_needs_more_evidence(client, funded_pair):
    ngo, m1, _ = funded_pair
    img = make_test_image(seed=20, metadata_text="Receipt Total: $100.00 (no code shown)")
    _, sub = issue_and_submit(client, m1, ngo["id"], img)
    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    assert res["verifier"]["challenge_code_visible"] is False
    codes = {c["code"] for c in res["skeptic"]["concerns"]}
    assert "CHALLENGE_CODE_NOT_VISIBLE" in codes
    assert res["milestone_status"] == "NEEDS_MORE_EVIDENCE"


def test_near_duplicate_recompressed_image_caught_across_milestones(client, funded_pair):
    ngo, m1, m2 = funded_pair
    ch1 = client.post(f"/milestones/{m1}/challenge", json={"user_id": ngo["id"]}).json()
    img1 = make_test_image(seed=42, size=(120, 120), fmt="PNG", metadata_text=f"Code {ch1['code']}")
    client.post(
        f"/milestones/{m1}/submissions",
        data={
            "challenge_id": ch1["challenge_id"],
            "submitted_by": ngo["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
        },
        files=[("files", ("first.png", img1, "image/png"))],
    )

    # Second submission on Milestone 2 uses a resized JPEG of the same visual scene -> different SHA-256!
    ch2 = client.post(f"/milestones/{m2}/challenge", json={"user_id": ngo["id"]}).json()
    img2 = make_test_image(seed=42, size=(160, 160), fmt="JPEG", metadata_text=f"Code {ch2['code']}")
    sub2 = client.post(
        f"/milestones/{m2}/submissions",
        data={
            "challenge_id": ch2["challenge_id"],
            "submitted_by": ngo["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
        },
        files=[("files", ("reused_resized.jpg", img2, "image/jpeg"))],
    ).json()

    assert any(f["flag"] == "NEAR_DUPLICATE_IMAGE" for f in sub2["flags"])
    res = client.post(f"/submissions/{sub2['submission_id']}/analyze").json()
    assert any(h["kind"] == "NEAR_DUPLICATE_IMAGE" for h in res["similarity_hits"])
    assert res["skeptic"]["recommendation"] == "hold"
    assert res["milestone_status"] == "HUMAN_REVIEW"


def test_receipt_amount_mismatch_flagged_by_skeptic(client, funded_pair):
    ngo, m1, _ = funded_pair  # m1 tranche is 100
    ch = client.post(f"/milestones/{m1}/challenge", json={"user_id": ngo["id"]}).json()
    img = make_test_image(seed=77, metadata_text=f"Code {ch['code']} | Receipt Total: $20.00")
    sub = client.post(
        f"/milestones/{m1}/submissions",
        data={
            "challenge_id": ch["challenge_id"],
            "submitted_by": ngo["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
        },
        files=[("files", ("receipt.png", img, "image/png"))],
    ).json()
    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    codes = {c["code"] for c in res["skeptic"]["concerns"]}
    assert "RECEIPT_AMOUNT_MISMATCH" in codes
    assert res["skeptic"]["fraud_risk"] >= 0.65
    assert res["milestone_status"] == "HUMAN_REVIEW"


def test_skeptic_llm_cannot_lower_deterministic_risk_floor(client, funded_pair, monkeypatch):
    ngo, m1, _ = funded_pair
    img = make_test_image(seed=99, metadata_text="No challenge code here")
    _, sub = issue_and_submit(client, m1, ngo["id"], img)

    monkeypatch.setattr(llm, "llm_available", lambda: True)

    def fake_generate(system, user, images=None):
        if "Skeptic Agent" in system:
            # Prompt-injected or hallucinating model tries to clear the submission
            return {"concerns": [], "fraud_risk": 0.0, "explanation": "Looks totally fine!"}
        return {
            "challenge_code_visible": False,
            "observed_challenge_code": None,
            "matched_requirements": [],
            "missing_requirements": ["code"],
            "extracted_text": "",
            "claimed_amount_on_receipt": None,
            "confidence": 0.2,
            "explanation": "No code visible",
        }

    monkeypatch.setattr(llm, "generate_json", fake_generate)
    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    assert res["skeptic"]["source"] == "llm"
    assert res["skeptic"]["fraud_risk"] >= res["skeptic"]["rule_risk_floor"] >= 0.70
    assert res["skeptic"]["recommendation"] == "hold"


def test_verifier_rejects_wrong_observed_challenge_code_from_llm(client, funded_pair, monkeypatch):
    ngo, m1, _ = funded_pair
    img = make_test_image(seed=55)
    _, sub = issue_and_submit(client, m1, ngo["id"], img)

    monkeypatch.setattr(llm, "llm_available", lambda: True)
    monkeypatch.setattr(
        llm,
        "generate_json",
        lambda system, user, images=None: (
            {
                "challenge_code_visible": True,
                "observed_challenge_code": "000000",  # does not match issued code
                "matched_requirements": [],
                "missing_requirements": [],
                "extracted_text": "000000",
                "claimed_amount_on_receipt": 100.0,
                "confidence": 0.9,
                "explanation": "Saw 000000",
            }
            if "evidence verification" in system
            else {"concerns": [], "fraud_risk": 0.1, "explanation": "ok"}
        ),
    )
    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    assert res["verifier"]["challenge_code_visible"] is False


def test_elastic_similarity_integration_when_configured(client, funded_pair, monkeypatch):
    import httpx

    ngo, m1, _ = funded_pair
    ch = client.post(f"/milestones/{m1}/challenge", json={"user_id": ngo["id"]}).json()
    img = make_test_image(seed=63, metadata_text=f"Code {ch['code']} | Total: $100.00")
    sub = client.post(
        f"/milestones/{m1}/submissions",
        data={
            "challenge_id": ch["challenge_id"],
            "submitted_by": ngo["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "capture_source": "in_app_camera",
            "lat": 18.52,
            "lng": 73.85,
        },
        files=[("files", ("doc.png", img, "image/png"))],
    ).json()

    monkeypatch.setattr(settings, "similarity_backend", "elastic")
    monkeypatch.setattr(settings, "elastic_url", "https://elastic.example.test")

    class FakeResp:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data

        def json(self):
            return self._data

    monkeypatch.setattr(httpx, "put", lambda *a, **kw: FakeResp(201, {"result": "created"}))
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **kw: FakeResp(
            200,
            {
                "hits": {
                    "hits": [
                        {
                            "_score": 4.2,
                            "_source": {"submission_id": 999, "milestone_id": 888},
                        }
                    ]
                }
            },
        ),
    )

    res = client.post(f"/submissions/{sub['submission_id']}/analyze").json()
    assert any(h["kind"] == "ELASTIC_SIMILAR_EVIDENCE" for h in res["similarity_hits"])
    assert res["skeptic"]["recommendation"] == "hold"
    assert res["milestone_status"] == "HUMAN_REVIEW"
