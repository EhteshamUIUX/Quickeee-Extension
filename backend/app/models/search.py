"""ORM models for the visual price-comparison workflow.

A SearchRun is one user search. It owns one ReferenceProduct (the Quickeee
product) and many CompetitorMatch rows (visually-matched competitor listings).
All timestamps are stored as naive UTC because asyncpg rejects tz-aware
datetimes against `TIMESTAMP WITHOUT TIME ZONE` columns in filters.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SearchRun(Base):
    __tablename__ = "search_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    query: Mapped[str] = mapped_column(String(512), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending|running|done|error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    reference: Mapped["ReferenceProduct | None"] = relationship(
        back_populates="run", uselist=False, cascade="all, delete-orphan"
    )
    matches: Mapped[list["CompetitorMatch"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class ReferenceProduct(Base):
    """The Quickeee product chosen as the source of truth for the search."""

    __tablename__ = "reference_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("search_runs.id", ondelete="CASCADE"), unique=True, index=True
    )

    name: Mapped[str] = mapped_column(String(512))
    brand: Mapped[str | None] = mapped_column(String(255), nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    mrp: Mapped[float | None] = mapped_column(Float, nullable=True)
    discount_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    product_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Local path of the downloaded source image (the visual-search seed).
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_phash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    run: Mapped[SearchRun] = relationship(back_populates="reference")


class CompetitorMatch(Base):
    """A competitor listing that passed visual + AI verification."""

    __tablename__ = "competitor_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("search_runs.id", ondelete="CASCADE"), index=True
    )

    platform: Mapped[str] = mapped_column(String(64))  # Amazon, Flipkart, Myntra...
    title: Mapped[str] = mapped_column(String(512))
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    mrp: Mapped[float | None] = mapped_column(Float, nullable=True)
    availability: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_url: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Visual + AI scoring.
    phash_distance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    visual_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0-100
    match_score: Mapped[float] = mapped_column(Float, default=0.0)  # 0-100 (AI)
    confidence: Mapped[str] = mapped_column(String(16), default="low")  # high|medium|low
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    run: Mapped[SearchRun] = relationship(back_populates="matches")
