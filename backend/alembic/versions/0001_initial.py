"""initial schema: search_runs, reference_products, competitor_matches

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "search_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("query", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_search_runs_query", "search_runs", ["query"])

    op.create_table(
        "reference_products",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("search_runs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("brand", sa.String(length=255), nullable=True),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("mrp", sa.Float(), nullable=True),
        sa.Column("discount_pct", sa.Float(), nullable=True),
        sa.Column("product_url", sa.Text(), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("image_path", sa.Text(), nullable=True),
        sa.Column("image_phash", sa.String(length=128), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_reference_products_run_id", "reference_products", ["run_id"])

    op.create_table(
        "competitor_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("search_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("mrp", sa.Float(), nullable=True),
        sa.Column("availability", sa.String(length=64), nullable=True),
        sa.Column("product_url", sa.Text(), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("phash_distance", sa.Integer(), nullable=True),
        sa.Column("visual_similarity", sa.Float(), nullable=True),
        sa.Column("match_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("confidence", sa.String(length=16), nullable=False, server_default="low"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("accepted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_competitor_matches_run_id", "competitor_matches", ["run_id"])


def downgrade() -> None:
    op.drop_table("competitor_matches")
    op.drop_table("reference_products")
    op.drop_table("search_runs")
