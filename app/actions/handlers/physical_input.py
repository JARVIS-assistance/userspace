"""Physical input handlers.

These are disabled by default and require OS-level accessibility permissions on
macOS. They intentionally support only small, explicit operations.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def _escape_applescript(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _require_enabled(enabled: bool) -> None:
    if not enabled:
        raise HandlerError("physical_input disabled by policy")
    if sys.platform != "darwin":
        raise HandlerError(f"physical_input not supported on {sys.platform}")


async def _run_script(script: str) -> None:
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
            f"physical input failed rc={proc.returncode}: {err.decode(errors='replace')[:300]}"
        )


def make_keyboard_type(enabled: bool, max_chars: int = 4000):
    async def keyboard_type(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        text = action.payload or action.target or ""
        if not text:
            raise HandlerError("missing keyboard text")
        if len(text) > max_chars:
            raise HandlerError(
                f"keyboard_type rejected: {len(text)} chars > max {max_chars}"
            )
        script = (
            'tell application "System Events" to keystroke '
            f'"{_escape_applescript(text)}"'
        )
        await _run_script(script)
        if bool(action.args.get("enter", False)):
            await _run_script('tell application "System Events" to key code 36')
        return {"typed_length": len(text), "enter": bool(action.args.get("enter", False))}

    return keyboard_type


def make_hotkey(enabled: bool):
    async def hotkey(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        raw = str(action.command or action.args.get("keys") or action.target or "").lower()
        keys = [k.strip() for k in raw.replace("+", ",").split(",") if k.strip()]
        if not keys:
            raise HandlerError("missing hotkey keys")
        modifiers = [k for k in keys[:-1] if k in {"command", "cmd", "control", "ctrl", "option", "alt", "shift"}]
        key = keys[-1]
        applescript_mods = []
        for mod in modifiers:
            if mod in {"command", "cmd"}:
                applescript_mods.append("command down")
            elif mod in {"control", "ctrl"}:
                applescript_mods.append("control down")
            elif mod in {"option", "alt"}:
                applescript_mods.append("option down")
            elif mod == "shift":
                applescript_mods.append("shift down")
        using = f" using {{{', '.join(applescript_mods)}}}" if applescript_mods else ""
        script = (
            'tell application "System Events" to keystroke '
            f'"{_escape_applescript(key)}"{using}'
        )
        await _run_script(script)
        return {"keys": keys}

    return hotkey


def make_mouse_click(enabled: bool):
    async def mouse_click(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        try:
            x = int(action.args.get("x"))
            y = int(action.args.get("y"))
        except (TypeError, ValueError) as e:
            raise HandlerError("mouse_click requires integer args x and y") from e
        clicks = int(action.args.get("clicks", 1))
        if clicks < 1 or clicks > 3:
            raise HandlerError("mouse_click clicks must be between 1 and 3")
        for _ in range(clicks):
            await _run_script(f'tell application "System Events" to click at {{{x}, {y}}}')
        return {"x": x, "y": y, "clicks": clicks}

    return mouse_click


def make_mouse_drag(enabled: bool):
    async def mouse_drag(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        raise HandlerError("mouse_drag not implemented safely on this runtime")

    return mouse_drag
