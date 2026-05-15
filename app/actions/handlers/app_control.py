"""Application control handler."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

from app.client_context import application_profiles_from_names
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def _escape_applescript(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


ABSTRACT_APP_TARGETS = {
    "browser",
    "default_browser",
    "web_browser",
}

def make_app_control(enabled: bool):
    async def app_control(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("app_control disabled by policy")
        command, app_name = _normalize_command_and_app(action)
        if command == "focus":
            command = "activate"
        if command not in {"open", "activate", "quit", "close", "new_file", "new_tab"}:
            raise HandlerError(f"unsupported app_control command: {command!r}")
        if not app_name:
            raise HandlerError("missing target app")
        if app_name.strip().lower() in ABSTRACT_APP_TARGETS:
            raise HandlerError(
                "invalid app_control target: browser. "
                "Use open_url for browser URLs, or app_control/open with a concrete app target like Chrome/Safari."
            )

        if sys.platform != "darwin":
            raise HandlerError(f"app_control not supported on {sys.platform}")

        if command in {"open", "activate"}:
            exists = await _application_exists(app_name)
            if not exists:
                raise HandlerError(
                    f"application not found: {app_name}. Install it or use the exact macOS app name."
                )
            await _open_application(app_name)
            return _app_control_result(app_name, command)

        if command in {"new_file", "new_tab"}:
            await _activate_application(app_name)
            await _send_new_file_hotkey()
            return _app_control_result(app_name, command)

        escaped = _escape_applescript(app_name)
        if command in {"quit", "close"}:
            script = f'tell application "{escaped}" to quit'
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
        return _app_control_result(app_name, command)

    return app_control


def _app_control_result(app_name: str, command: str) -> dict[str, Any]:
    profile = _application_profile_for_result(app_name)
    return {
        "app": app_name,
        "command": command,
        "active_app": app_name,
        "launched_app": app_name if command in {"open", "activate"} else "",
        "bundle_id": str(profile.get("bundle_id") or ""),
        "source": "app_control",
    }


def _application_profile_for_result(app_name: str) -> dict[str, object]:
    profiles = application_profiles_from_names([app_name])
    return profiles[0] if profiles else {}


def _normalize_command_and_app(action: ClientAction) -> tuple[str, str]:
    command = (action.command or _command_from_type(action.type) or "open").strip().lower()
    app_name = (
        action.target
        or action.payload
        or str((action.args or {}).get("app") or "")
        or str((action.args or {}).get("app_name") or "")
        or str((action.args or {}).get("application") or "")
    ).strip()
    return command, _resolve_installed_app_name(app_name)


def _resolve_installed_app_name(app_name: str) -> str:
    key = _app_name_key(app_name)
    if not key:
        return app_name
    for installed_name in _installed_application_names():
        if _app_name_key(installed_name) == key:
            return installed_name
    return app_name


def _app_name_key(value: str) -> str:
    return "".join(ch for ch in value.casefold() if ch.isalnum())


def _installed_application_names() -> list[str]:
    if sys.platform != "darwin":
        return []
    names: list[str] = []
    for directory in _application_directories():
        try:
            children = list(directory.iterdir())
        except OSError:
            continue
        for child in children:
            if child.suffix.lower() == ".app":
                names.append(child.stem)
    return list(dict.fromkeys(name for name in names if name.strip()))


def _application_directories() -> list[Path]:
    return [
        Path("/Applications"),
        Path.home() / "Applications",
        Path("/System/Applications"),
        Path("/System/Applications/Utilities"),
    ]


def _command_from_type(action_type: str) -> str | None:
    return {
        "app.open": "open",
        "app.focus": "focus",
        "app.close": "close",
    }.get(str(action_type).strip().lower())


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
    await _activate_application(app_name)


async def _activate_application(app_name: str) -> None:
    escaped = _escape_applescript(app_name)
    proc = await asyncio.create_subprocess_exec(
        "osascript",
        "-e",
        f'tell application "{escaped}" to activate',
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=2.0)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()


async def _send_new_file_hotkey() -> None:
    proc = await asyncio.create_subprocess_exec(
        "osascript",
        "-e",
        'tell application "System Events" to keystroke "n" using {command down}',
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise HandlerError(
            f"app_control new_file failed rc={proc.returncode}: {err.decode(errors='replace')[:300]}"
        )
