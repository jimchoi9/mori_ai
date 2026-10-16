"""Shared web/worker settings. Credentials must be explicitly configured."""
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from urllib.parse import urlsplit
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = Field(repr=False)
    app_env: Literal["local", "test", "production"] = "production"
    dev_auth_enabled: bool = False
    dev_ai_enabled: bool = False
    app_origin: str = "http://127.0.0.1:8000"
    session_cookie_allow_insecure_local: bool = False
    session_ttl_seconds: int = Field(default=86400, ge=60, le=604800)
    consent_policy_version: str = Field(default="local-2026-10-16", min_length=1, max_length=100)
    google_client_id: str = ""
    google_client_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    google_redirect_uri: str = ""
    kakao_client_id: str = ""
    kakao_client_secret: SecretStr = Field(default=SecretStr(""), repr=False)
    kakao_redirect_uri: str = ""

    @property
    def auth_providers(self) -> list[str]:
        return [provider for provider in ("google", "kakao")
                if getattr(self, f"{provider}_client_id")]

    @model_validator(mode="after")
    def validate_oauth(self):
        for provider in ("google", "kakao"):
            client_id = getattr(self, f"{provider}_client_id")
            secret = getattr(self, f"{provider}_client_secret").get_secret_value()
            callback = getattr(self, f"{provider}_redirect_uri")
            if not client_id:
                if secret:
                    raise ValueError("OAuth secret requires client ID")
                continue
            if client_id != client_id.strip() or len(client_id) > 1024:
                raise ValueError("invalid OAuth client ID")
            if provider == "google" and not secret:
                raise ValueError("Google OAuth requires client secret")
            if callback != f"{self.app_origin}/api/v1/auth/{provider}/callback":
                raise ValueError("OAuth callback must match configured origin and provider path")
        return self

    @model_validator(mode="after")
    def validate_auth(self):
        if self.dev_ai_enabled and self.app_env != "local":
            raise ValueError("DEV_AI_ENABLED requires APP_ENV=local")
        if self.dev_auth_enabled and self.app_env != "local":
            raise ValueError("DEV_AUTH_ENABLED requires APP_ENV=local")
        if self.session_cookie_allow_insecure_local and self.app_env != "local":
            raise ValueError("insecure cookie requires APP_ENV=local")
        origin = urlsplit(self.app_origin)
        if (origin.scheme not in {"http", "https"} or not origin.hostname
                or origin.username or origin.password or origin.path
                or origin.query or origin.fragment or "*" in self.app_origin):
            raise ValueError("APP_ORIGIN must be an exact HTTP origin without wildcard or path")
        try:
            origin.port
        except ValueError as exc:
            raise ValueError("invalid APP_ORIGIN port") from exc
        return self

    @property
    def session_cookie_secure(self) -> bool:
        return not (self.app_env == "local" and self.session_cookie_allow_insecure_local)

    storage_mode: Literal["local"] = "local"
    storage_root: Path = Path("/app/media")
    worker_poll_seconds: float = Field(default=1, gt=0, le=60, allow_inf_nan=False)
    normalized_webp_lossless: bool = True
    normalized_max_edge: int = Field(default=4096, ge=4, le=16383)
    normalized_max_bytes: int = Field(default=20971520, ge=1)
    result_webp_quality: int = Field(default=90, ge=1, le=100)
    thumbnail_webp_quality: int = Field(default=80, ge=1, le=100)
    thumbnail_max_edge: int = Field(default=480, ge=4, le=480)

    @field_validator("normalized_webp_lossless")
    @classmethod
    def require_lossless_normalization(cls, value: bool) -> bool:
        if not value:
            raise ValueError("normalized WebP must be lossless")
        return value

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
