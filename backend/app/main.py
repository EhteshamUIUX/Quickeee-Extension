"""FastAPI application entrypoint."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import get_logger, setup_logging
from app.db.base import Base
from app.db.session import engine
from app.services.browser import browser_manager
from app.utils.images import ensure_store

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    ensure_store()
    # Create tables on startup (Alembic is provided for production migrations).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Quickeee Visual Agent started (mock_mode=%s)", settings.mock_mode)
    yield
    await browser_manager.shutdown()
    await engine.dispose()


app = FastAPI(
    title="Quickeee Visual Price Agent",
    version="1.0.0",
    description="Visual-matching-first price comparison across Indian marketplaces.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)

# Serve downloaded images so the frontend can render reference/competitor thumbs.
os.makedirs(settings.image_store_dir, exist_ok=True)
app.mount("/images", StaticFiles(directory=settings.image_store_dir), name="images")


@app.get("/")
async def root() -> dict:
    return {"service": "quickeee-visual-agent", "docs": "/docs"}
