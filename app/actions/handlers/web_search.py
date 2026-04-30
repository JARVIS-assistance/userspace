"""Web search handler.

Phase 3 keeps this local and conservative: opens a search URL in a specific
browser (default: Chrome) so the user sees results. Does not scrape.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote_plus

from app.actions.handlers._browsers import DEFAULT_BROWSER, open_in_browser
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def make_web_search(enabled: bool):
    async def web_search(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("web_search disabled by policy")
        query = (action.command or action.payload or action.target or "").strip()
        if not query:
            raise HandlerError("missing search query")

        browser = ""
        if action.args:
            raw = action.args.get("browser")
            if isinstance(raw, str):
                browser = raw

        url = f"https://www.google.com/search?q={quote_plus(query)}"
        try:
            used = await open_in_browser(url, browser=browser or DEFAULT_BROWSER)
        except RuntimeError as e:
            raise HandlerError(str(e)) from e
        return {"query": query, "opened": url, "browser": used}

    return web_search
