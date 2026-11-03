"""Thin LLM wrapper. Providers: ``offline`` (no key, deterministic) and ``gemini`` (free tier).

Agents ask for JSON and validate it with Pydantic. If the provider fails or returns invalid
output, callers fall back to the deterministic offline logic, so the app never hard-depends on
an external service.
"""
import json
import re
from typing import Any

import httpx

from app.config import settings


class LLMError(Exception):
    pass


def _extract_json(text: str) -> Any:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"model did not return valid JSON: {e}")


def llm_available() -> bool:
    return settings.llm_provider == "gemini" and bool(settings.gemini_api_key)


def generate_json(system: str, user: str) -> Any:
    """Return parsed JSON from the configured provider, trying fallback models on failure.
    Raises LLMError if every model fails."""
    if not llm_available():
        raise LLMError("no LLM provider configured")
    models = [settings.gemini_model] + [m.strip() for m in settings.gemini_fallback_models.split(",")
                                       if m.strip()]
    errors = []
    for model in dict.fromkeys(models):
        try:
            return _call_gemini(model, system, user)
        except LLMError as e:
            errors.append(f"{model}: {e}")
    raise LLMError("; ".join(errors)[:600])


def _call_gemini(model: str, system: str, user: str) -> Any:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
    }
    try:
        r = httpx.post(url, params={"key": settings.gemini_api_key}, json=body, timeout=45)
    except httpx.HTTPError as e:
        raise LLMError(f"request failed: {e}")
    if r.status_code != 200:
        raise LLMError(f"gemini error {r.status_code}: {r.text[:200]}")
    try:
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, ValueError):
        raise LLMError("unexpected gemini response shape")
    return _extract_json(text)
