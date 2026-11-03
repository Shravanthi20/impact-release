"""List Gemini models that support generateContent. Run from backend/: python scripts/list_models.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402

r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
              params={"key": settings.gemini_api_key, "pageSize": 200}, timeout=30)
print(r.status_code)
for m in r.json().get("models", []):
    if "generateContent" in m.get("supportedGenerationMethods", []):
        print(m["name"])
