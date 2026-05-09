"""Calendar control handler.

The backend contract can emit calendar actions. The local client currently
supports opening the user's calendar app directly and rejects state-changing
calendar mutations with a clear error until a provider integration is configured.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


SUPPORTED_COMMANDS = {
    "open",
    "list_events",
    "create_event",
    "update_event",
    "delete_event",
}


def make_calendar_control(enabled: bool):
    async def calendar_control(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("calendar_control disabled by policy")

        command = (action.command or "open").strip().lower()
        if command not in SUPPORTED_COMMANDS:
            raise HandlerError(f"unsupported calendar_control command: {command!r}")

        if command != "open":
            raise HandlerError(
                "calendar provider integration is not configured in userspace",
                output={"command": command, "provider": _provider(action)},
            )

        if sys.platform == "darwin":
            proc = await asyncio.create_subprocess_exec(
                "open",
                "-a",
                "Calendar",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise HandlerError(
                    "calendar launch failed: "
                    f"{err.decode(errors='replace')[:300]}"
                )
            return {"command": command, "provider": _provider(action), "app": "Calendar"}

        raise HandlerError(f"calendar_control open not supported on {sys.platform}")

    return calendar_control


def _provider(action: ClientAction) -> str:
    raw = (action.args or {}).get("provider")
    return raw.strip() if isinstance(raw, str) and raw.strip() else "local"
