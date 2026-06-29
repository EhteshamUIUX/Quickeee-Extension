"""Search endpoints — drive the visual price-comparison workflow."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, get_db
from app.models.search import SearchRun
from app.schemas.search import SearchRequest, SearchResult, SearchSummary
from app.services.orchestrator import assemble_result, load_run, run_workflow

router = APIRouter(prefix="/search", tags=["search"])


async def _run_in_background(
    run_id: int, price_hint: float | None, slug: str | None
) -> None:
    # Background tasks need their own session (the request session is closed).
    async with SessionLocal() as db:
        await run_workflow(db, run_id, price_hint=price_hint, slug=slug)


@router.post("", response_model=SearchResult, status_code=202)
async def create_search(
    payload: SearchRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SearchResult:
    """Start a search. Returns immediately with a pending run; poll GET /search/{id}."""
    run = SearchRun(query=payload.query.strip(), status="pending")
    db.add(run)
    await db.commit()
    await db.refresh(run)

    background.add_task(
        _run_in_background, run.id, payload.quickeee_price_hint, payload.slug
    )

    run = await load_run(db, run.id)
    return assemble_result(run)


@router.post("/sync", response_model=SearchResult)
async def create_search_sync(
    payload: SearchRequest,
    db: AsyncSession = Depends(get_db),
) -> SearchResult:
    """Run the full workflow synchronously (handy in mock mode / for demos)."""
    run = SearchRun(query=payload.query.strip(), status="pending")
    db.add(run)
    await db.commit()
    await db.refresh(run)

    await run_workflow(
        db, run.id, price_hint=payload.quickeee_price_hint, slug=payload.slug
    )
    run = await load_run(db, run.id)
    return assemble_result(run)


@router.get("/{run_id}", response_model=SearchResult)
async def get_search(run_id: int, db: AsyncSession = Depends(get_db)) -> SearchResult:
    run = await load_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Search run not found")
    return assemble_result(run)


@router.get("", response_model=list[SearchSummary])
async def list_searches(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[SearchSummary]:
    stmt = select(SearchRun).order_by(SearchRun.id.desc()).limit(limit)
    res = await db.execute(stmt)
    return [SearchSummary.model_validate(r) for r in res.scalars().all()]
