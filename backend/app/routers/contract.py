from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.agents.contract_agent import ContractProposal, propose_contract

router = APIRouter()


class IntentIn(BaseModel):
    intent_text: str = Field(min_length=10, max_length=2000)
    budget: float = Field(gt=0)
    currency: str = "USD"
    holdback_pct: float = Field(default=10.0, ge=0, le=50)


@router.post("/projects/intent", response_model=ContractProposal)
def draft_from_intent(body: IntentIn):
    """Contract agent: returns a DRAFT only. Nothing is saved or funded until the donor edits
    and approves it by calling POST /projects."""
    return propose_contract(body.intent_text, body.budget, body.currency, body.holdback_pct)
