"""Application settings, loaded from environment variables or a .env file."""
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo-root .env, regardless of the directory the server is started from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), extra="ignore")

    database_url: str = "sqlite:///./impactrelease.db"

    # PayPal. PAYPAL_MODE=stub runs a local fake so the app works without credentials.
    paypal_mode: str = "stub"  # stub | sandbox
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_webhook_id: str = ""
    paypal_base_url: str = "https://api-m.sandbox.paypal.com"
    app_base_url: str = os.getenv("RENDER_EXTERNAL_URL") or "http://localhost:8000"

    # LLM (free tier). LLM_PROVIDER=gemini calls the Google Gemini API.
    llm_provider: str = "gemini"  # gemini | offline (used only by unit tests)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_fallback_models: str = "gemini-2.5-flash,gemini-3.8-flash"
    strict_gemini_only: bool = True  # when llm_provider=='gemini', never silently use offline fallback

    # Release guardrails (Phase 5 will enforce more of these).
    human_approval_threshold: float = 500.0

    # Evidence capture (Phase 3)
    challenge_ttl_minutes: int = 30
    clock_skew_seconds: int = 120
    max_upload_mb: int = 10
    evidence_dir: str = str(ENV_FILE.parent / "data" / "evidence")

    # Verification & similarity search (Phase 4)
    similarity_backend: str = "local"  # local | elastic
    elastic_url: str = ""
    elastic_api_key: str = ""
    elastic_index: str = "impactrelease-evidence"
    phash_hamming_threshold: int = 10

    # Confirmations, rules engine & challenge window (Phase 5)
    min_beneficiary_confirmations: int = 2
    default_challenge_window_hours: float = 1.0


settings = Settings()
