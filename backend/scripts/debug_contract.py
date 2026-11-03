"""Show exactly why the contract agent falls back. Run from backend/: python scripts/debug_contract.py"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from app.agents import llm  # noqa: E402
from app.agents.contract_agent import SYSTEM_PROMPT, ContractDraftLLM  # noqa: E402

intent = "Fund school fees for 30 girls in Pune and make sure they attend this term"
t = time.time()
try:
    raw = llm.generate_json(SYSTEM_PROMPT, f"Budget: 1000 USD\n<intent>\n{intent}\n</intent>")
    print(f"LLM ok in {time.time() - t:.1f}s")
    print(raw)
    try:
        ContractDraftLLM.model_validate(raw)
        print("VALIDATION OK")
    except ValidationError as e:
        print("VALIDATION FAILED:", e)
except llm.LLMError as e:
    print(f"LLM FAILED after {time.time() - t:.1f}s:", e)
