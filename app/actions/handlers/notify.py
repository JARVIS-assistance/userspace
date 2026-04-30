"""Desktop notification — type='notify'.

OpenAPI 매핑:
- target  → 알림 제목 (없으면 'JARVIS')
- payload → 알림 본문 (없으면 description)
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def _applescript_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


async def notify(action: ClientAction) -> dict[str, Any]:
    title = (action.target or "JARVIS").strip() or "JARVIS"
    message = (action.payload or action.description or "").strip()

    if sys.platform == "darwin":
        script = (
            f'display notification "{_applescript_escape(message)}" '
            f'with title "{_applescript_escape(title)}"'
        )
        proc = await asyncio.create_subprocess_exec(
            "osascript",
            "-e",
            script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise HandlerError(
                f"osascript failed (rc={proc.returncode}): {err.decode(errors='replace').strip()}"
            )
        return {"platform": "darwin", "title": title}

    if sys.platform.startswith("linux"):
        proc = await asyncio.create_subprocess_exec(
            "notify-send",
            title,
            message,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise HandlerError(
                f"notify-send failed (rc={proc.returncode}): {err.decode(errors='replace').strip()}"
            )
        return {"platform": "linux", "title": title}

    # Windows or others — graceful no-op for now
    return {
        "platform": sys.platform,
        "title": title,
        "skipped": True,
        "reason": "no native notification on this platform",
    }
