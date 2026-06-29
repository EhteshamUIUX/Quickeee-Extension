"""Aggregate v1 router."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routers import discovery, health, search

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(search.router)
api_router.include_router(discovery.router)
