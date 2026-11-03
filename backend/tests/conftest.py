import os
import tempfile

os.environ["EVIDENCE_DIR"] = tempfile.mkdtemp(prefix="ir_evidence_")

os.environ["DATABASE_URL"] = "sqlite://"  # in-memory
os.environ["PAYPAL_MODE"] = "stub"
os.environ["LLM_PROVIDER"] = "offline"  # tests never call a real LLM

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.db import session as db_session
from app.main import app
from app.services import paypal_client


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[db_session.get_session] = override
    paypal_client._client = paypal_client.StubPayPal()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded(client):
    donor = client.post("/users", json={"role": "donor", "name": "D", "email": "d@x.org"}).json()
    ngo = client.post("/users", json={"role": "ngo", "name": "N", "email": "n@x.org",
                                      "paypal_email": "ngo@sandbox.test"}).json()
    return donor, ngo
