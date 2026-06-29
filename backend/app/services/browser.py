"""Shared async Playwright browser manager.

A single Chromium instance is launched lazily and reused across scrapers.
Each scrape gets its own context (isolated cookies / UA). In mock mode the
browser is never launched.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class BrowserManager:
    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._lock = asyncio.Lock()

    async def _ensure_browser(self):
        if self._browser is not None:
            return self._browser
        async with self._lock:
            if self._browser is not None:
                return self._browser
            from playwright.async_api import async_playwright

            logger.info("Launching Chromium (headless=%s)", settings.headless)
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=settings.headless,
                args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
            )
            return self._browser

    @asynccontextmanager
    async def page(self):
        browser = await self._ensure_browser()
        context = await browser.new_context(
            user_agent=settings.request_user_agent,
            viewport={"width": 1366, "height": 900},
            locale="en-IN",
        )
        page = await context.new_page()
        page.set_default_timeout(settings.browser_timeout_ms)
        try:
            yield page
        finally:
            await context.close()

    async def shutdown(self) -> None:
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None


browser_manager = BrowserManager()
