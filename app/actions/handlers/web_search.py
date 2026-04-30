"""Web search handler.

Per the client action contract, the frontend must not turn `web_search` into
a browser tab. Search pages should arrive as `open_url`; current-page
resolution should arrive as `browser_control/extract_dom`.
"""

from __future__ import annotations

from typing import Any
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def make_web_search(enabled: bool):
    async def web_search(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("web_search disabled by policy")
        raise HandlerError(
            "unsupported action: web_search; use open_url for browser search pages",
            output={
                "type": action.type,
                "command": action.command,
                "target": action.target,
                "args_keys": sorted((action.args or {}).keys()),
            },
        )

    return web_search
