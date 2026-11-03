def test_frontend_ui_and_static_assets_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "ag-grid-community" in r.text
    assert 'id="reviewGrid"' in r.text
    assert 'id="ledgerGrid"' in r.text

    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/styles.css").status_code == 200
    assert client.get("/static/manifest.json").status_code == 200


def test_demo_seed_populates_ledger_and_review_queue(client):
    seed_res = client.post("/demo/seed")
    assert seed_res.status_code == 200, seed_res.text
    data = seed_res.json()
    assert data["seeded"] is True and len(data["milestones"]) == 3

    projects = client.get("/projects").json()
    assert len(projects) == 1
    assert projects[0]["funded"] == 1000.0
    assert projects[0]["released"] == 300.0

    ledger = client.get("/ledger/public").json()
    assert len(ledger) == 1
    assert ledger[0]["amount"] == 300.0
    assert ledger[0]["status"] == "SUCCESS"
    assert "All verification checks passed" in ledger[0]["reason"]

    queue = client.get("/review/queue").json()
    assert len(queue) == 2
    by_mid = {item["milestone_id"]: item for item in queue}
    m2, m3 = data["milestones"][1], data["milestones"][2]
    assert m2 in by_mid and m3 in by_mid

    m2_codes = {c["code"] for c in by_mid[m2]["concerns"]}
    assert "NEAR_DUPLICATE_IMAGE" in m2_codes
    assert "RECEIPT_AMOUNT_MISMATCH" in m2_codes

    assert by_mid[m3]["status"] == "DISPUTED"
    assert len(by_mid[m3]["open_disputes"]) == 1
