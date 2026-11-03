from datetime import datetime, timezone

import pytest

from app.agents import llm
from app.config import settings
from tests.test_phase1_payments import fund, make_project
from tests.test_phase4_verification import make_test_image


def test_redteam_endpoint_catches_all_attacks_with_zero_false_rejections(client):
    r = client.post("/eval/redteam/run")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_cases"] == 12
    assert data["attack_cases"] == 9
    assert data["attacks_caught"] == 9
    assert data["attack_detection_rate"] == 1.0
    assert data["legitimate_cases"] == 3
    assert data["false_rejections"] == 0
    assert data["false_rejection_rate"] == 0.0
    assert all(c["correct"] for c in data["cases"])


def test_collusion_network_graph_detects_shared_devices_and_repeat_confirmers(client, seeded):
    donor, ngo1 = seeded
    ngo2 = client.post(
        "/users",
        json={"role": "ngo", "name": "NGO Two", "email": "n2@x.org", "paypal_email": "n2@sandbox.test"},
    ).json()

    p1 = make_project(client, donor, ngo1, tranches=(100,), total=200)
    p2 = make_project(client, donor, ngo2, tranches=(100,), total=200)
    fund(client, p1["project"]["id"])
    fund(client, p2["project"]["id"])

    m1 = p1["milestones"][0]["id"]
    m2 = p2["milestones"][0]["id"]

    # Both distinct NGOs submit from the exact same device_id -> shared-device collusion signal!
    for idx, (mid, uid) in enumerate([(m1, ngo1["id"]), (m2, ngo2["id"])], start=1):
        ch = client.post(f"/milestones/{mid}/challenge", json={"user_id": uid}).json()
        img = make_test_image(seed=idx * 50, metadata_text=f"Challenge {ch['code']} | Total: $100")
        client.post(
            f"/milestones/{mid}/submissions",
            data={
                "challenge_id": ch["challenge_id"],
                "submitted_by": uid,
                "captured_at": datetime.now(timezone.utc).isoformat(),
                "capture_source": "in_app_camera",
                "device": '{"device_id": "SHARED-ANDROID-9988"}',
            },
            files=[("files", (f"s{idx}.png", img, "image/png"))],
        )
        # Same vendor confirms across both unrelated projects
        inv = client.post(
            f"/milestones/{mid}/confirmations/invite",
            json={"kind": "vendor", "contact_ref": "colluding-vendor@test.org"},
        ).json()
        client.post(f"/confirm/{inv['token']}", json={"confirmed": True, "reported_amount": 100})

    graph = client.get("/graph/risk").json()
    codes = {a["code"] for a in graph["alerts"]}
    assert "SHARED_DEVICE_ACROSS_NGOS" in codes
    assert "REPEAT_CONFIRMER_ACROSS_PROJECTS" in codes


def test_strict_gemini_only_raises_instead_of_falling_back_to_offline(monkeypatch):
    from app.agents.contract_agent import propose_contract

    monkeypatch.setattr(settings, "strict_gemini_only", True)
    monkeypatch.setattr(llm, "llm_available", lambda: True)

    def fail(*a, **kw):
        raise llm.LLMError("simulated Gemini API failure")

    monkeypatch.setattr(llm, "generate_json", fail)
    with pytest.raises(llm.LLMError):
        propose_contract("Fund school fees for 30 girls in Pune", 1000.0)
