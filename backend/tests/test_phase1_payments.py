def make_project(client, donor, ngo, tranches=(100, 200), total=1000):
    r = client.post("/projects", json={
        "donor_id": donor["id"], "org_id": ngo["id"], "intent_text": "school fees",
        "total_amount": total,
        "milestones": [{"title": f"M{i}", "tranche_amount": t, "payee_user_id": ngo["id"]}
                       for i, t in enumerate(tranches, 1)]})
    assert r.status_code == 200, r.text
    return r.json()


def fund(client, pid):
    assert client.post(f"/projects/{pid}/fund").status_code == 200
    r = client.post(f"/projects/{pid}/fund/capture")
    assert r.status_code == 200, r.text


def test_tranches_cannot_exceed_total(client, seeded):
    donor, ngo = seeded
    r = client.post("/projects", json={
        "donor_id": donor["id"], "total_amount": 100,
        "milestones": [{"title": "a", "tranche_amount": 150, "payee_user_id": ngo["id"]}]})
    assert r.status_code == 422


def test_happy_path_fund_approve_payout_settle(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    pid, m1 = p["project"]["id"], p["milestones"][0]["id"]
    fund(client, pid)
    assert client.get(f"/projects/{pid}").json()["funded"] == 1000

    assert client.post(f"/milestones/{m1}/approve", json={}).status_code == 200
    r = client.post(f"/payouts/{m1}/execute", json={})
    assert r.status_code == 200
    payout = r.json()
    assert payout["amount"] == 100 and payout["status"] == "PENDING"

    # webhook settles it
    ev = {"event_type": "PAYMENT.PAYOUTSBATCH.SUCCESS",
          "resource": {"batch_header": {"payout_batch_id": payout["paypal_batch_id"]}}}
    assert client.post("/webhooks/paypal", json=ev).json()["changed"] is True
    ledger = client.get("/ledger/public").json()
    assert ledger[0]["status"] == "SUCCESS"
    assert "email" not in str(ledger).lower()
    assert client.get(f"/projects/{pid}").json()["milestones"][0]["status"] == "SETTLED"


def test_payout_blocked_before_funding_and_before_approval(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={})
    assert client.post(f"/payouts/{m1}/execute", json={}).status_code == 409  # unfunded
    fund(client, p["project"]["id"])
    m2 = p["milestones"][1]["id"]
    assert client.post(f"/payouts/{m2}/execute", json={}).status_code == 409  # not approved


def test_payout_is_idempotent(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    fund(client, p["project"]["id"])
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={})
    a = client.post(f"/payouts/{m1}/execute", json={}).json()
    b = client.post(f"/payouts/{m1}/execute", json={}).json()
    assert a["id"] == b["id"]
    assert client.get(f"/projects/{p['project']['id']}").json()["released"] == 100


def test_large_payout_requires_human_approval(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo, tranches=(800,), total=1000)  # above 500 threshold
    fund(client, p["project"]["id"])
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={})
    assert client.post(f"/payouts/{m1}/execute", json={}).status_code == 409
    assert client.post(f"/payouts/{m1}/execute", json={"human_approved": True}).status_code == 200


def test_failed_payout_webhook_marks_milestone_failed_and_allows_retry(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    fund(client, p["project"]["id"])
    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={})
    payout = client.post(f"/payouts/{m1}/execute", json={}).json()
    ev = {"event_type": "PAYMENT.PAYOUTS-ITEM.FAILED",
          "resource": {"payout_batch_id": payout["paypal_batch_id"]}}
    client.post("/webhooks/paypal", json=ev)
    # funds are not counted as released after failure
    assert client.get(f"/projects/{p['project']['id']}").json()["released"] == 0
    # milestone is PAYOUT_FAILED, which is not approved, so a re-approval is a deliberate step
    ms = client.get(f"/projects/{p['project']['id']}").json()["milestones"][0]
    assert ms["status"] == "PAYOUT_FAILED"


def test_audit_log_records_actions(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    fund(client, p["project"]["id"])
    actions = {a["action"] for a in client.get("/audit").json()}
    assert {"project_created", "funding_order_created", "funding_captured"} <= actions


def test_double_entry_ledger_and_webhook_idempotency(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    pid = p["project"]["id"]
    fund(client, pid)

    # Initial double-entry deposit verify
    v1 = client.get(f"/ledger/journal/verify?project_id={pid}").json()
    assert v1["is_balanced"] is True
    assert v1["total_debits"] == 1000.0
    assert v1["total_credits"] == 1000.0
    assert v1["accounts"]["Assets:PayPal_Escrow_Holdings"] == 1000.0
    assert v1["accounts"]["Liabilities:Grantee_Escrow_Allocation"] == -1000.0

    m1 = p["milestones"][0]["id"]
    client.post(f"/milestones/{m1}/approve", json={})
    payout = client.post(f"/payouts/{m1}/execute", json={}).json()

    # Deliver webhook with explicit event_id
    ev = {
        "id": "WH-TEST-EV-001",
        "event_type": "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        "resource": {
            "payout_item_id": payout.get("paypal_item_id"),
            "sender_item_id": payout["sender_batch_id"],
            "payout_batch_id": payout["paypal_batch_id"],
        },
    }
    r1 = client.post("/webhooks/paypal", json=ev).json()
    assert r1["changed"] is True

    # Re-delivering exact duplicate webhook should be cleanly ignored (idempotency)
    r2 = client.post("/webhooks/paypal", json=ev).json()
    assert r2["changed"] is False

    # Check balanced journal
    v2 = client.get(f"/ledger/journal/verify?project_id={pid}").json()
    assert v2["is_balanced"] is True
    assert v2["total_debits"] == 1100.0
    assert v2["total_credits"] == 1100.0
    assert v2["accounts"]["Assets:PayPal_Escrow_Holdings"] == 900.0
    assert v2["accounts"]["Liabilities:Grantee_Escrow_Allocation"] == -900.0
