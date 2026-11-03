"""Live end-to-end check of the contract agent. Run from backend/: python scripts/check_contract_agent.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.contract_agent import propose_contract  # noqa: E402

p = propose_contract("Fund school fees for 30 girls in Pune and make sure they attend this term", 1000)
print("source:", p.source, "| holdback:", p.holdback_amount)
for m in p.milestones:
    print(f"{m.order_no}. {m.title} - {m.tranche_amount}")
    for e in m.evidence_requirements:
        print("     -", e)
print("questions:", p.clarifying_questions)
print("warnings:", p.warnings)
