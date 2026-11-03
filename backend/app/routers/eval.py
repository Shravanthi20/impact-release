from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.db.session import get_session
from app.services.graph import analyze_collusion_network
from app.services.redteam import run_redteam_suite

router = APIRouter()


@router.post("/eval/redteam/run")
def run_redteam_endpoint(session: Session = Depends(get_session)):
    """Execute the 12-case red-team benchmark across all defense layers."""
    return run_redteam_suite(session)


@router.get("/graph/risk")
def get_risk_graph(session: Session = Depends(get_session)):
    """Inspect network collusion graph edges and shared-device/repeat-confirmer alerts."""
    return analyze_collusion_network(session)
