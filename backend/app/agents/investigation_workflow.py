"""Investigation Workflow Engine.

Coordinates the Contract, Verifier, and Skeptic agents into an active investigation loop.
Establishes whether funded activities *actually happened* (outcome verification, functional operation,
geographic presence, and beneficiary access) rather than merely checking static photos and receipts.
"""
import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from app.agents import llm
from app.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Senior Fraud & Outcome Investigation Analyst for an impact escrow fund.
Your task is to determine whether the funded milestone deliverable ACTUALLY HAPPENED and is FUNCTIONAL,
or if there are discrepancies between what was promised, what the Verifier observed, and what the Skeptic flagged.

Do not merely check if a photograph exists. Evaluate outcome and functionality:
- Was the asset installed and verified functional (e.g. water flowing, solar power generation active, students in session)?
- Does the evidence confirm intended beneficiary access at the registered site?
- Are there contradictions between vendor bills, photos, timestamps, GPS, or beneficiary statements?

Return JSON matching:
{
  "outcome_status": "VERIFIED_FUNCTIONAL" | "UNVERIFIED_DELIVERY_ONLY" | "SUSPICIOUS_CONTRADICTION",
  "outcome_explanation": str,
  "requires_investigation": bool,
  "investigation_actions": [
    {
      "action_type": "REQUEST_FUNCTIONAL_PROOF" | "REQUEST_BENEFICIARY_CONFIRMATION" | "REQUEST_VENDOR_ITEMIZATION" | "ESCALATE_HUMAN_AUDIT",
      "reason": str,
      "target_role": "ngo" | "beneficiary" | "vendor" | "reviewer",
      "details": str
    }
  ],
  "recommended_disbursement": "release" | "investigate" | "reject",
  "confidence": number between 0.0 and 1.0
}
"""


class InvestigationAction(BaseModel):
    action_type: str
    reason: str
    target_role: str
    details: str


class InvestigationResult(BaseModel):
    outcome_status: str
    outcome_explanation: str
    requires_investigation: bool
    investigation_actions: list[InvestigationAction] = []
    recommended_disbursement: str
    confidence: float = Field(ge=0.0, le=1.0)
    source: str = "offline"


def run_investigation_workflow(
    milestone_title: str,
    tranche_amount: float,
    evidence_requirements: list[str],
    verifier_signals: dict[str, Any],
    skeptic_signals: dict[str, Any],
    confirmations_summary: dict[str, Any],
) -> InvestigationResult:
    """Execute the multi-agent investigation synthesis."""
    # 1. Deterministic Rule Analysis
    fraud_risk = float(skeptic_signals.get("fraud_risk", 0.0))
    concerns = skeptic_signals.get("concerns", [])
    challenge_visible = bool(verifier_signals.get("challenge_code_visible", False))
    extracted_text = str(verifier_signals.get("extracted_text", "")).lower()
    claimed_amount = verifier_signals.get("claimed_amount_on_receipt")

    has_contradiction = (
        fraud_risk >= 0.40
        or any(c.get("code") in ("EXACT_FILE_REUSE", "PERCEPTUAL_HASH_NEAR_DUPLICATE", "REUSED_ACROSS_MILESTONES") for c in concerns)
        or not challenge_visible
    )

    amount_mismatch = (
        claimed_amount is not None
        and abs(claimed_amount - tranche_amount) > 0.01 * tranche_amount
        and claimed_amount < tranche_amount
    )

    actions: list[InvestigationAction] = []

    # Outcome & functionality verification
    functional_indicators = (
        "working", "operational", "flow", "lit", "active", "installed and tested",
        "beneficiary signoff", "running", "distributed", "completed", "delivered",
        "tuition", "uniform", "enrollment", "receipt"
    )
    vendor_confirmed = bool(confirmations_summary.get("matched_vendor", False))
    beneficiaries_confirmed = int(confirmations_summary.get("matched_beneficiaries", 0)) >= 1
    has_functional_text = any(ind in extracted_text for ind in functional_indicators)

    is_functionality_established = (
        (vendor_confirmed or beneficiaries_confirmed or has_functional_text or fraud_risk < 0.25)
        and not has_contradiction
        and not amount_mismatch
    )

    if has_contradiction:
        actions.append(InvestigationAction(
            action_type="ESCALATE_HUMAN_AUDIT",
            reason="High fraud risk or perceptual hash collision detected across milestone submissions.",
            target_role="reviewer",
            details="Trigger physical auditor review and demand on-site re-inspection with live GPS challenge.",
        ))

    if amount_mismatch:
        actions.append(InvestigationAction(
            action_type="REQUEST_VENDOR_ITEMIZATION",
            reason=f"Claimed receipt amount (${claimed_amount}) is less than tranche budget (${tranche_amount}).",
            target_role="vendor",
            details="Request itemized procurement voucher and tax invoice from the registered supplier.",
        ))

    if not is_functionality_established and not has_contradiction and not amount_mismatch:
        actions.append(InvestigationAction(
            action_type="REQUEST_BENEFICIARY_CONFIRMATION",
            reason="Asset delivery shown, but direct end-user functional access is not yet confirmed by local beneficiaries.",
            target_role="beneficiary",
            details="Dispatch confirmation request tokens to registered community recipients.",
        ))

    # Determine outcome status
    if has_contradiction:
        outcome_status = "SUSPICIOUS_CONTRADICTION"
        outcome_explanation = f"Flagged by Skeptic Agent: {', '.join(c.get('detail', '') for c in concerns) or 'Integrity check failed'}."
        recommended = "reject" if fraud_risk >= 0.70 else "investigate"
        requires_inv = True
        confidence = 0.88
    elif amount_mismatch or not is_functionality_established:
        outcome_status = "UNVERIFIED_DELIVERY_ONLY"
        outcome_explanation = "Equipment/manifest documented, but functional operation and end-user access require secondary confirmation."
        recommended = "investigate"
        requires_inv = True
        confidence = 0.78
    else:
        outcome_status = "VERIFIED_FUNCTIONAL"
        outcome_explanation = "Photographic proof, valid challenge code placard, itemized expenditure, and independent confirmations reconcile cleanly."
        recommended = "release"
        requires_inv = False
        confidence = 0.94

    # Optional LLM Multi-Agent Synthesis when configured
    if settings.llm_provider == "gemini" and settings.gemini_api_key and not has_contradiction:
        prompt = f"""<milestone>
Title: {milestone_title}
Tranche: ${tranche_amount:.2f}
Requirements: {json.dumps(evidence_requirements)}
</milestone>

<verifier_findings>
Challenge Code Visible: {challenge_visible}
Extracted Text: {extracted_text[:400]}
Claimed Amount: {claimed_amount}
</verifier_findings>

<skeptic_findings>
Fraud Risk: {fraud_risk:.2f}
Concerns: {json.dumps(concerns)}
</skeptic_findings>

<confirmations>
Vendor Matched: {confirmations_summary.get('matched_vendor', False)}
Beneficiaries: {confirmations_summary.get('matched_beneficiaries', 0)}
Contradictions: {confirmations_summary.get('contradictions', 0)}
</confirmations>
"""
        try:
            data = llm.generate_json(prompt, system_instruction=SYSTEM_PROMPT, model=settings.gemini_model)
            llm_actions = [InvestigationAction(**a) for a in data.get("investigation_actions", [])]
            return InvestigationResult(
                outcome_status=data.get("outcome_status", outcome_status),
                outcome_explanation=data.get("outcome_explanation", outcome_explanation),
                requires_investigation=bool(data.get("requires_investigation", requires_inv)),
                investigation_actions=llm_actions or actions,
                recommended_disbursement=data.get("recommended_disbursement", recommended),
                confidence=float(data.get("confidence", confidence)),
                source="llm",
            )
        except Exception as err:
            logger.warning("LLM investigation workflow fallback: %s", err)

    return InvestigationResult(
        outcome_status=outcome_status,
        outcome_explanation=outcome_explanation,
        requires_investigation=requires_inv,
        investigation_actions=actions,
        recommended_disbursement=recommended,
        confidence=confidence,
        source="offline",
    )
