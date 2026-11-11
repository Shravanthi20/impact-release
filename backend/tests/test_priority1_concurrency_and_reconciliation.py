import concurrent.futures
from starlette.testclient import TestClient

from app.db.models import FinancialDiscrepancy, Funding, JournalEntry, WebhookEventRecord
from app.main import app


def test_concurrent_payout_requests_prevent_double_disbursement(client, seeded):
    """Scenario: Two simultaneous payout requests when combined value exceeds available non-holdback balance.
    Total: $1,000, 20% holdback ($200 retained).
    Milestone 1: $500
    Milestone 2: $450
    Total milestones = $950 <= $1000, but available for immediate milestone disbursement is only $800.
    Expected: Exactly one succeeds, the other is rejected with 409 (insufficient funded balance).
    """
    donor, ngo = seeded
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "Concurrent payout stress test",
        "total_amount": 1000.0, "currency": "USD", "holdback_pct": 20.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 500.0, "payee_user_id": ngo["id"]},
            {"title": "M2", "tranche_amount": 450.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")

    m1 = p["milestones"][0]["id"]
    m2 = p["milestones"][1]["id"]
    client.post(f"/milestones/{m1}/approve", json={"actor": "reviewer", "human_approved": True})
    client.post(f"/milestones/{m2}/approve", json={"actor": "reviewer", "human_approved": True})

    def execute_payout(mid):
        c = TestClient(app)
        return c.post(f"/payouts/{mid}/execute", json={"actor": "reviewer", "human_approved": True})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(execute_payout, m1)
        f2 = executor.submit(execute_payout, m2)
        r1 = f1.result()
        r2 = f2.result()
        results = [r1.status_code, r2.status_code]

    # Exactly one payout succeeded (200), and the other failed with insufficient balance (409)
    assert 200 in results
    assert 409 in results

    # Assert that project released amount never exceeds the available balance
    proj = client.get(f"/projects/{pid}").json()
    assert proj["released"] <= 800.0
    assert proj["released"] in (450.0, 500.0)


def test_payout_exceeds_available_balance_rejected(client, seeded):
    donor, ngo = seeded
    # Total: $1,000, 30% holdback ($300 retained). Available = $700.
    # M1 = $400, M2 = $400 (Sum 800 <= 1000).
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "Balance invariant test",
        "total_amount": 1000.0, "currency": "USD", "holdback_pct": 30.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 400.0, "payee_user_id": ngo["id"]},
            {"title": "M2", "tranche_amount": 400.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")
    m1 = p["milestones"][0]["id"]
    m2 = p["milestones"][1]["id"]
    client.post(f"/milestones/{m1}/approve", json={"actor": "reviewer", "human_approved": True})
    client.post(f"/milestones/{m2}/approve", json={"actor": "reviewer", "human_approved": True})

    # First payout consumes $400 of the $700 available
    assert client.post(f"/payouts/{m1}/execute", json={"actor": "reviewer", "human_approved": True}).status_code == 200

    # Second payout of $400 exceeds remaining $300 -> rejected with 409
    res = client.post(f"/payouts/{m2}/execute", json={"actor": "reviewer", "human_approved": True})
    assert res.status_code == 409
    assert "insufficient funded balance" in res.json()["detail"]


def test_ngo_prevented_from_executing_own_payout(client, seeded):
    donor, ngo = seeded
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "RBAC separation test",
        "total_amount": 500.0, "currency": "USD", "holdback_pct": 0.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 300.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={"actor": "reviewer", "human_approved": True})

    # NGO attempts to execute their own payout -> 403 Forbidden
    res = client.post(f"/payouts/{m1}/execute", json={"actor": "ngo"})
    assert res.status_code == 403
    assert "cannot approve or execute" in res.json()["detail"]


def test_duplicate_webhook_deduplication_and_idempotency(client, seeded):
    donor, ngo = seeded
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "Webhook deduplication test",
        "total_amount": 500.0, "currency": "USD", "holdback_pct": 0.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 300.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={"actor": "reviewer", "human_approved": True})
    payout = client.post(f"/payouts/{m1}/execute", json={"actor": "reviewer", "human_approved": True}).json()

    event = {
        "id": "WH-EV-TEST-UNIQUE-001",
        "event_type": "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        "resource": {
            "payout_item_id": payout["paypal_item_id"],
            "sender_item_id": payout["sender_batch_id"],
            "payout_batch_id": payout["paypal_batch_id"],
        },
    }
    r1 = client.post("/webhooks/paypal", json=event).json()
    assert r1["changed"] is True

    # Same webhook delivered a second time
    r2 = client.post("/webhooks/paypal", json=event).json()
    assert r2["changed"] is False

    # Check journal has exactly 2 entries (1 deposit + 1 disbursement), not duplicate
    journal = client.get(f"/ledger/journal?project_id={pid}").json()
    assert len(journal) == 2


def test_payout_state_machine_illegal_transition_logs_discrepancy(client, seeded):
    donor, ngo = seeded
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "State machine integrity test",
        "total_amount": 500.0, "currency": "USD", "holdback_pct": 0.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 300.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={"actor": "reviewer", "human_approved": True})
    payout = client.post(f"/payouts/{m1}/execute", json={"actor": "reviewer", "human_approved": True}).json()

    # Settle the payout
    client.post("/webhooks/paypal", json={
        "id": "WH-SETTLE-001",
        "event_type": "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        "resource": {"sender_item_id": payout["sender_batch_id"]},
    })

    # Now simulate an invalid backwards transition: PayPal tries to send PROCESSING on a SETTLED payout
    illegal_ev = {
        "id": "WH-ILLEGAL-002",
        "event_type": "PAYMENT.PAYOUTSBATCH.PROCESSING",
        "resource": {"payout_batch_id": payout["paypal_batch_id"]},
    }
    res = client.post("/webhooks/paypal", json=illegal_ev).json()
    assert res["changed"] is False

    # Verify that an exception was recorded in FinancialDiscrepancy queue
    discrepancies = client.get("/reconciliation/discrepancies").json()
    assert any(d["issue_type"] == "STATUS_DESYNC" for d in discrepancies)


def test_reconciliation_service_auto_recovers_missing_webhook(client, seeded):
    donor, ngo = seeded
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "Reconciliation engine test",
        "total_amount": 500.0, "currency": "USD", "holdback_pct": 0.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 300.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={"actor": "reviewer", "human_approved": True})
    payout = client.post(f"/payouts/{m1}/execute", json={"actor": "reviewer", "human_approved": True}).json()

    # Suppose PayPal completed the payout in PayPal's system, but the webhook never arrived (dropped by network)
    # StubPayPal has the payout recorded in its in-memory map. Let's update StubPayPal's batch status to SUCCESS:
    from app.services.paypal_client import get_paypal
    pp = get_paypal()
    if hasattr(pp, "payouts") and payout["sender_batch_id"] in pp.payouts:
        pp.payouts[payout["sender_batch_id"]]["batch_status"] = "SUCCESS"

    # Payout in DB is still PENDING
    assert client.get(f"/projects/{pid}").json()["milestones"][0]["status"] == "PAYOUT_SENT"

    # Trigger automated reconciliation service
    recon = client.post("/reconciliation/run").json()
    assert recon["reconciled_payouts"] >= 1

    # Verify that reconciliation settled the milestone without requiring a webhook!
    updated_proj = client.get(f"/projects/{pid}").json()
    assert updated_proj["milestones"][0]["status"] == "SETTLED"


def test_investigation_workflow_outcome_and_contradiction_handling(client, seeded):
    from app.agents.investigation_workflow import run_investigation_workflow

    # Scenario A: Contradiction / Fraud detected
    res_a = run_investigation_workflow(
        milestone_title="Solar Pump Installation",
        tranche_amount=1000.0,
        evidence_requirements=["Operational solar pump", "Beneficiary signoff"],
        verifier_signals={"challenge_code_visible": False, "extracted_text": "Random pump photo"},
        skeptic_signals={"fraud_risk": 0.65, "concerns": [{"code": "EXACT_FILE_REUSE", "detail": "Reused photo"}]},
        confirmations_summary={"matched_vendor": False, "matched_beneficiaries": 0, "contradictions": 1},
    )
    assert res_a.outcome_status == "SUSPICIOUS_CONTRADICTION"
    assert res_a.requires_investigation is True
    assert any(a.action_type == "ESCALATE_HUMAN_AUDIT" for a in res_a.investigation_actions)

    # Scenario B: Amount mismatch triggers itemization
    res_b = run_investigation_workflow(
        milestone_title="Field Supplies",
        tranche_amount=800.0,
        evidence_requirements=["Receipt"],
        verifier_signals={"challenge_code_visible": True, "extracted_text": "Receipt total: $400", "claimed_amount_on_receipt": 400.0},
        skeptic_signals={"fraud_risk": 0.10, "concerns": []},
        confirmations_summary={"matched_vendor": True, "matched_beneficiaries": 0, "contradictions": 0},
    )
    assert res_b.requires_investigation is True
    assert any(a.action_type == "REQUEST_VENDOR_ITEMIZATION" for a in res_b.investigation_actions)


def test_project_forensic_audit_timeline(client, seeded):
    donor, ngo = seeded
    p = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"],
        "intent_text": "Audit timeline verification",
        "total_amount": 500.0, "currency": "USD", "holdback_pct": 10.0,
        "milestones": [
            {"title": "M1", "tranche_amount": 400.0, "payee_user_id": ngo["id"]},
        ],
    }).json()
    pid = p["project"]["id"]
    client.post(f"/projects/{pid}/fund")
    client.post(f"/projects/{pid}/fund/capture")

    # Fetch audit timeline
    tl = client.get(f"/audit/timeline/{pid}").json()
    assert tl["project_id"] == pid
    trail = tl["forensic_audit_trail"]
    assert trail["1_who_initiated_funding"]["donor_id"] == donor["id"]
    assert trail["2_how_much_captured"]["captured_amount"] == 500.0
    assert len(trail["3_milestones_and_evidence"]) == 1
    assert len(trail["4_double_entry_ledger_journal"]) >= 1
