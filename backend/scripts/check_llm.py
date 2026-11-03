"""Quick live check of the configured LLM. Run from backend/: python scripts/check_llm.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import llm  # noqa: E402
from app.config import settings  # noqa: E402

print("provider:", settings.llm_provider, "| model:", settings.gemini_model,
      "| key set:", bool(settings.gemini_api_key))
try:
    print("response:", llm.generate_json('Return JSON {"ok": true}', "hi"))
except llm.LLMError as e:
    print("ERROR:", str(e)[:600])
