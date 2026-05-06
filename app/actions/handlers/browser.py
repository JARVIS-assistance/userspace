"""Capability-style browser action handler.

Accepted backend shape:
- type="browser", command="open" | "navigate" | "search"
- legacy-compatible command names are also accepted: browser.open, browser.navigate,
  browser.search.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote_plus

from app.actions.handlers._browsers import open_browser, open_in_browser
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction

ALLOWED_BROWSER_NAMES = {"chrome", "safari", "firefox", "edge", "default"}
ALLOWED_SEARCH_ENGINES = {"google", "naver", "duckduckgo"}


def make_browser(
    *,
    enabled_capabilities: set[str],
    default_browser: str,
    search_engine: str,
):
    async def browser(action: ClientAction) -> dict[str, Any]:
        command = _normalize_command(action.command or action.type)
        capability = f"browser.{command}"
        if capability not in enabled_capabilities:
            raise HandlerError(
                f"browser capability disabled by policy: {capability}",
                output={"reason": "policy_disabled", "capability": capability},
            )

        if command == "open":
            selected_browser = _browser_arg(action, default_browser)
            try:
                used = await open_browser(selected_browser)
            except RuntimeError as e:
                raise HandlerError(str(e), output={"reason": "execution_failed"}) from e
            return {"command": "open", "browser": used}

        if command == "navigate":
            url = _url_arg(action)
            selected_browser = _browser_arg(action, default_browser)
            try:
                used = await open_in_browser(url, browser=selected_browser)
            except RuntimeError as e:
                raise HandlerError(str(e), output={"reason": "execution_failed", "url": url}) from e
            return {"command": "navigate", "opened": url, "browser": used}

        if command == "search":
            query = str((action.args or {}).get("query") or action.payload or "").strip()
            if not query:
                raise HandlerError(
                    "browser.search requires structured args.query",
                    output={"reason": "backend_validation_failed"},
                )
            selected_browser = _browser_arg(action, default_browser)
            engine = _search_engine_arg(action, search_engine)
            url = build_search_url(query=query, engine=engine)
            try:
                used = await open_in_browser(url, browser=selected_browser)
            except RuntimeError as e:
                raise HandlerError(
                    str(e),
                    output={
                        "reason": "execution_failed",
                        "query": query,
                        "engine": engine,
                        "url": url,
                    },
                ) from e
            return {
                "command": "search",
                "query": query,
                "engine": engine,
                "generated_url": url,
                "opened": url,
                "browser": used,
            }

        raise HandlerError(
            f"unsupported browser command: {action.command!r}",
            output={"reason": "handler_unsupported", "command": action.command},
        )

    return browser


def build_search_url(*, query: str, engine: str) -> str:
    normalized = _normalize_search_engine(engine)
    encoded = quote_plus(query.strip())
    if normalized == "naver":
        return f"https://search.naver.com/search.naver?query={encoded}"
    if normalized == "duckduckgo":
        return f"https://duckduckgo.com/?q={encoded}"
    return f"https://www.google.com/search?q={encoded}"


def _normalize_command(value: str | None) -> str:
    command = (value or "open").strip().lower().replace("_", ".")
    if command.startswith("browser."):
        command = command.split(".", 1)[1]
    if command in {"open", "navigate", "search"}:
        return command
    return command


def _browser_arg(action: ClientAction, default_browser: str) -> str:
    raw = (action.args or {}).get("browser") or default_browser
    browser = str(raw or "default").strip().lower()
    if browser not in ALLOWED_BROWSER_NAMES:
        raise HandlerError(
            f"unsupported browser: {browser!r}",
            output={"reason": "backend_validation_failed", "browser": browser},
        )
    return browser


def _search_engine_arg(action: ClientAction, default_engine: str) -> str:
    raw = (action.args or {}).get("engine") or (action.args or {}).get("search_engine") or default_engine
    return _normalize_search_engine(str(raw or "google"))


def _normalize_search_engine(engine: str) -> str:
    value = engine.strip().lower().replace("-", "")
    if value == "duckduckgo":
        return "duckduckgo"
    if value in ALLOWED_SEARCH_ENGINES:
        return value
    raise HandlerError(
        f"unsupported search engine: {engine!r}",
        output={"reason": "backend_validation_failed", "engine": engine},
    )


def _url_arg(action: ClientAction) -> str:
    url = str((action.args or {}).get("url") or action.target or action.payload or "").strip()
    if not url:
        raise HandlerError(
            "browser.navigate requires structured args.url or target URL",
            output={"reason": "backend_validation_failed"},
        )
    if not url.startswith(("http://", "https://")):
        raise HandlerError(
            "browser.navigate requires http(s) URL",
            output={"reason": "backend_validation_failed", "url": url},
        )
    return url
