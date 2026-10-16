"""Shared web/worker settings. Credentials must be explicitly configured."""
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = Field(repr=False)
    storage_mode: Literal["local"] = "local"
    storage_root: Path = Path("/app/media")
    worker_poll_seconds: float = Field(default=1, gt=0, le=60, allow_inf_nan=False)

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        try:
            url = make_url(value)
        except Exception as exc:
            raise ValueError("DATABASE_URL must be a PostgreSQL asyncpg URL") from exc
        if url.drivername != "postgresql+asyncpg" or not url.host or not url.database:
            raise ValueError("DATABASE_URL must use postgresql+asyncpg with host and database")
        return value

    @field_validator("storage_root")
    @classmethod
    def validate_storage_root(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("STORAGE_ROOT must be absolute")
        return value
