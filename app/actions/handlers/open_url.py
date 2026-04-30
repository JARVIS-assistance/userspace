"""Open URL in a specific browser — type='open_url'.

OpenAPI 매핑:
- target  → URL (없으면 payload 사용)
- args.browser → 브라우저 이름 (chrome, safari, firefox, edge, brave, arc, default)
                  지정 없으면 DEFAULT_BROWSER (=chrome)

기본 브라우저로 열려면 args.browser='default' 명시 (그러면 webbrowser.open 사용).
"""

from __future__ import annotations

from typing import Any

from app.actions.handlers._browsers import DEFAULT_BROWSER, open_in_browser
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction

ALLOWED_SCHEMES = ("http://", "https://")


async def open_url(action: ClientAction) -> dict[str, Any]:
    url = (action.target or action.payload or "").strip()
    if not url:
        raise HandlerError("missing target URL")

    if not any(url.startswith(scheme) for scheme in ALLOWED_SCHEMES):
        raise HandlerError(
            f"only {','.join(ALLOWED_SCHEMES)} URLs allowed; got {url[:80]!r}"
        )

    browser = ""
    if action.args:
        raw = action.args.get("browser")
        if isinstance(raw, str):
            browser = raw

    try:
        used = await open_in_browser(url, browser=browser or DEFAULT_BROWSER)
    except RuntimeError as e:
        raise HandlerError(str(e)) from e

    return {"opened": url, "browser": used}
