"""Application configuration loaded from environment variables.

Supports both discrete POSTGRES_* vars (Docker / docker-compose) and a single
DATABASE_URL override (Neon / managed Postgres). The override strips libpq-only
query params (sslmode, channel_binding) that asyncpg rejects, and forces SSL.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit, parse_qsl

from pydantic import AliasChoices, Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ---- App ----
    app_env: str = "development"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3000"

    # ---- Database ----
    postgres_user: str = "quickeee"
    postgres_password: str = "quickeee_secret"
    postgres_db: str = "quickeee_visual"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    # Full URL override (e.g. Neon). Takes precedence over POSTGRES_* if set.
    # Accepts either DATABASE_URL_OVERRIDE or DATABASE_URL (sibling-project name).
    database_url_override: str = Field(
        default="",
        validation_alias=AliasChoices("DATABASE_URL_OVERRIDE", "DATABASE_URL"),
    )

    # ---- AI Vision ----
    ai_provider: Literal["anthropic", "openai"] = "anthropic"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-8"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    # Minimum AI confidence (0-100) to accept a competitor match.
    match_acceptance_threshold: int = 90

    # ---- Quickeee source ----
    quickeee_base_url: str = "https://quickeee.com"
    quickeee_api_base: str = "https://api.quickeee.com"
    quickeee_api_token: str = ""
    # Live integration: capture the site's anonymous token via Playwright and
    # call the real catalog API. Works without any token/keys. Independent of
    # MOCK_MODE (which only controls competitor discovery + AI fallback).
    quickeee_live: bool = True
    quickeee_default_pincode: str = "400049"  # default store the site resolves (Mumbai)

    # ---- Reverse image / visual search ----
    # SerpApi is the most reliable path for Google Lens / Google Images.
    serpapi_key: str = ""
    bing_visual_search_key: str = ""  # Azure Bing Visual Search (fallback)
    visual_search_provider: Literal["serpapi", "playwright", "bing"] = "serpapi"

    # ---- Shopping search provider (name-based competitor discovery) ----
    # Serper.dev: 2,500 free searches/month (vs SerpApi's 250).
    serper_key: str = Field(
        default="",
        validation_alias=AliasChoices("SERPER_KEY", "SERPER_API_KEY"),
    )
    # "auto" picks serper if SERPER_KEY is set, else falls back to serpapi.
    search_provider: Literal["serper", "serpapi", "auto"] = Field(
        default="auto",
        validation_alias=AliasChoices("SEARCH_PROVIDER"),
    )

    # ---- Scraping / browser ----
    mock_mode: bool = True  # run end-to-end offline with deterministic fixtures
    headless: bool = True
    browser_timeout_ms: int = 30000
    max_competitor_candidates: int = 12
    request_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )

    # ---- Image storage ----
    image_store_dir: str = "./data/images"
    perceptual_hash_size: int = 16

    @computed_field  # type: ignore[prop-decorator]
    @property
    def active_search_provider(self) -> str:
        if self.search_provider == "serper":
            return "serper"
        if self.search_provider == "serpapi":
            return "serpapi"
        if self.serper_key:
            return "serper"
        if self.serpapi_key:
            return "serpapi"
        return "none"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        """Async (asyncpg) URL for the app."""
        if self.database_url_override:
            return self._normalize_async_url(self.database_url_override)
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def db_connect_args(self) -> dict[str, Any]:
        """asyncpg connect args. Force SSL when using a managed URL override."""
        if self.database_url_override and self._url_needs_ssl(self.database_url_override):
            return {"ssl": True}
        return {}

    @staticmethod
    def _url_needs_ssl(url: str) -> bool:
        query = dict(parse_qsl(urlsplit(url).query))
        return query.get("sslmode", "").lower() in {"require", "verify-full", "verify-ca"} or (
            "neon.tech" in url or "render.com" in url or "supabase" in url
        )

    @staticmethod
    def _normalize_async_url(url: str) -> str:
        """Coerce to asyncpg driver and strip libpq-only query params."""
        parts = urlsplit(url)
        scheme = parts.scheme
        if scheme in {"postgres", "postgresql"}:
            scheme = "postgresql+asyncpg"
        elif scheme == "postgresql+psycopg2":
            scheme = "postgresql+asyncpg"
        # asyncpg does not understand sslmode / channel_binding query params.
        kept = [
            (k, v)
            for k, v in parse_qsl(parts.query)
            if k.lower() not in {"sslmode", "channel_binding"}
        ]
        new_query = "&".join(f"{k}={v}" for k, v in kept)
        return urlunsplit((scheme, parts.netloc, parts.path, new_query, parts.fragment))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
