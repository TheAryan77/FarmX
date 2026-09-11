"""Runtime configuration for the FasalX AI service."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# services/ai/app/config.py -> services/ai -> services -> repo root
SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]

ARTIFACT_DIR = SERVICE_ROOT / "models"
ARTIFACT_PATH = ARTIFACT_DIR / "price_model.json"
METRICS_PATH = ARTIFACT_DIR / "price_metrics.json"
CSV_PATH = SERVICE_ROOT / "data" / "wheat_karnal.csv"


class Settings(BaseSettings):
    """Reads the repo-root .env, the single env file every workspace shares."""

    # `protected_namespaces=()` because pydantic reserves the `model_` prefix
    # and this service legitimately talks about models.
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        extra="ignore",
        protected_namespaces=(),
    )

    database_url: str = ""
    ai_port: int = 8000

    # Chat assistant. Absent in a checkout with no key — the /chat endpoint
    # then reports itself unavailable rather than the service failing to boot.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"


settings = Settings()
