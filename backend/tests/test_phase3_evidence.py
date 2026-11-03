from datetime import datetime, timedelta, timezone

import pytest

from app.services import evidence as ev
from tests.test_phase1_payments import fund, make_project

JPEG = b"\xff\xd8\xff\xe0" + b"fake-jpeg-bytes-1" * 20


def iso(dt):
    return dt.isoformat()


@pytest.fixture()
def funded(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    fund(client, p["project"]["id"])
    return ngo, p["milestones"][0]["id"], p["milestones"][1]["id"]


def challenge(client, mid, uid):
    r = client.post(f"/milestones/{mid}/challenge", json={"user_id": uid})
    assert r.status_code == 200, r.text
    return r.json()


def submit(client, mid, uid, ch, data=JPEG, ctype="image/jpeg", source="in_app_camera",
           captured=None, name="proof.jpg"):
    return client.post(
        f"/milestones/{mid}/submissions",
        data={"challenge_id": ch["challenge_id"], "submitted_by": uid,
              "captured_at": iso(captured or datetime.now(timezone.utc)),
              "capture_source": source, "lat": 18.52, "lng": 73.85,
              "device": '{"model": "test"}'},
        files=[("files", (name, data, ctype))])


def test_challenge_requires_funding_and_payee(client, seeded):
    donor, ngo = seeded
    p = make_project(client, donor, ngo)
    m = p["milestones"][0]["id"]
    assert client.post(f"/milestones/{m}/challenge", json={"user_id": ngo["id"]}).status_code == 409
    fund(client, p["project"]["id"])
    assert client.post(f"/milestones/{m}/challenge", json={"user_id": donor["id"]}).status_code == 409
    c = challenge(client, m, ngo["id"])
    assert len(c["code"]) == 6 and c["code"].isdigit()


def test_clean_submission_is_stored_hashed_and_marks_milestone(client, funded):
    ngo, m1, _ = funded
    r = submit(client, m1, ngo["id"], challenge(client, m1, ngo["id"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "SUBMITTED" and body["flags"] == []
    assert body["files"][0]["sha256"] == ev.sha256_hex(JPEG)
    subs = client.get(f"/milestones/{m1}/submissions").json()
    assert subs[0]["geo"]["lat"] == 18.52
    pid = client.get("/audit").json()
    assert any(a["action"] == "evidence_submitted" for a in pid)


def test_challenge_is_single_use(client, funded):
    ngo, m1, _ = funded
    ch = challenge(client, m1, ngo["id"])
    assert submit(client, m1, ngo["id"], ch).status_code == 200
    again = submit(client, m1, ngo["id"], ch, data=JPEG + b"x")
    assert again.status_code == 422 and "already used" in again.json()["detail"]


def test_challenge_cannot_be_used_on_another_milestone(client, funded):
    ngo, m1, m2 = funded
    ch = challenge(client, m1, ngo["id"])
    r = submit(client, m2, ngo["id"], ch)
    assert r.status_code == 422


def test_capture_time_outside_window_is_rejected(client, funded):
    ngo, m1, _ = funded
    ch = challenge(client, m1, ngo["id"])
    old = datetime.now(timezone.utc) - timedelta(hours=3)
    r = submit(client, m1, ngo["id"], ch, captured=old)
    assert r.status_code == 422 and "before the challenge" in r.json()["detail"]
    future = datetime.now(timezone.utc) + timedelta(hours=3)
    r = submit(client, m1, ngo["id"], ch, captured=future)
    assert r.status_code == 422


def test_expired_challenge_rejected(client, funded, monkeypatch):
    ngo, m1, _ = funded
    ch = challenge(client, m1, ngo["id"])
    real = ev.utcnow
    monkeypatch.setattr(ev, "utcnow", lambda: real() + timedelta(hours=2))
    r = submit(client, m1, ngo["id"], ch)
    assert r.status_code == 422 and "expired" in r.json()["detail"]


def test_reused_file_is_flagged_not_blocked(client, funded):
    ngo, m1, m2 = funded
    assert submit(client, m1, ngo["id"], challenge(client, m1, ngo["id"])).status_code == 200
    r = submit(client, m2, ngo["id"], challenge(client, m2, ngo["id"]))  # same bytes
    assert r.status_code == 200
    assert r.json()["status"] == "FLAGGED"
    assert r.json()["flags"][0]["flag"] == "DUPLICATE_FILE_REUSED"


def test_non_in_app_capture_is_flagged(client, funded):
    ngo, m1, _ = funded
    r = submit(client, m1, ngo["id"], challenge(client, m1, ngo["id"]), source="upload")
    assert r.json()["status"] == "FLAGGED"
    assert r.json()["flags"][0]["flag"] == "NOT_IN_APP_CAPTURE"


def test_bad_file_types_and_empty_files_rejected(client, funded):
    ngo, m1, _ = funded
    ch = challenge(client, m1, ngo["id"])
    assert submit(client, m1, ngo["id"], ch, data=b"MZ", ctype="application/x-msdownload",
                  name="evil.exe").status_code == 422
    assert submit(client, m1, ngo["id"], ch, data=b"").status_code == 422
    # a failed attempt must not burn the challenge
    assert submit(client, m1, ngo["id"], ch).status_code == 200


def test_client_filename_cannot_escape_storage(client, funded):
    ngo, m1, _ = funded
    r = submit(client, m1, ngo["id"], challenge(client, m1, ngo["id"]), name="../../evil.jpg")
    assert r.status_code == 200
    assert r.json()["files"][0]["filename"] == "evil.jpg"


def test_oversized_file_rejected(client, funded, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    ngo, m1, _ = funded
    r = submit(client, m1, ngo["id"], challenge(client, m1, ngo["id"]))
    assert r.status_code == 422 and "too large" in r.json()["detail"]


def test_only_the_payee_can_submit(client, funded):
    ngo, m1, _ = funded
    ch = challenge(client, m1, ngo["id"])
    other = client.post("/users", json={"role": "ngo", "name": "X", "email": "x@x.org"}).json()
    r = submit(client, m1, other["id"], ch)
    assert r.status_code == 422
