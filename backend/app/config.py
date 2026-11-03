"""Application settings, loaded from environment variables or a .env file."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./impactrelease.db"

    # PayPal. PAYPAL_MODE=stub runs a local fake so the app works without credentials.
    paypal_mode: str = "stub"  # stub | sandbox
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_webhook_id: str = ""
    paypal_base_url: str = "https://api-m.sandbox.paypal.com"
    app_base_url: str = "http://localhost:8000"

    # Release guardrails (Phase 5 will enforce more of these).
    human_approval_threshold: float = 500.0


settings = Settings()
