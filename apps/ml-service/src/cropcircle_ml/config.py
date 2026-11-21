"""Runtime settings for the private service."""

from functools import lru_cache
import re

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://cropcircle:cropcircle_dev@localhost:5432/cropcircle"
    redis_url: str = "redis://localhost:6379/0"
    ml_model_dir: str = "models"
    ml_service_key: str = ""
    ml_worker_enabled: bool = True
    node_env: str = "development"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    @model_validator(mode="after")
    def require_production_key(self):
        if self.node_env == "production" and not re.fullmatch(r"[A-Za-z0-9_-]{43,}", self.ml_service_key):
            raise ValueError("ML_SERVICE_KEY must contain at least 32 random bytes encoded as base64url")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
