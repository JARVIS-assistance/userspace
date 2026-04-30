"""Application control handler."""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def _escape_applescript(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


APP_ALIASES = {
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "firefox": "Firefox",
    "mozilla firefox": "Firefox",
    "safari": "Safari",
    "browser": "Google Chrome",
}


def make_app_control(enabled: bool):
    async def app_control(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("app_control disabled by policy")
        raw_command = (action.command or "open").strip()
        command = raw_command.lower()
        app_name = (action.target or action.payload or "").strip()
        if not app_name and command not in {"open", "activate", "quit", "close"}:
            app_name = raw_command
            command = "open"
        if not app_name:
            raise HandlerError("missing target app")
        app_name = APP_ALIASES.get(app_name.lower(), app_name)

        if sys.platform != "darwin":
            raise HandlerError(f"app_control not supported on {sys.platform}")

        if command in {"open", "activate"}:
            exists = await _application_exists(app_name)
            if not exists:
                raise HandlerError(
                    f"application not found: {app_name}. Install it or choose Chrome/Safari."
                )
            await _open_application(app_name)
            return {"app": app_name, "command": command}

        escaped = _escape_applescript(app_name)
        if command in {"quit", "close"}:
            script = f'tell application "{escaped}" to quit'
        else:
            raise HandlerError(f"unsupported app_control command: {command!r}")

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
                f"app_control failed rc={proc.returncode}: {err.decode(errors='replace')[:300]}"
            )
        return {"app": app_name, "command": command}

    return app_control


async def _application_exists(app_name: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "open",
        "-Ra",
        app_name,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=2.0)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return False
    return proc.returncode == 0


async def _open_application(app_name: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        "open",
        "-a",
        app_name,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    except asyncio.TimeoutError as e:
        proc.kill()
        await proc.communicate()
        raise HandlerError(f"application launch timed out: {app_name}") from e
    if proc.returncode != 0:
        raise HandlerError(
            f"application launch failed: {app_name}: {err.decode(errors='replace')[:300]}"
        )
