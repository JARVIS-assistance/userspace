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


def _pyautogui():
    try:
        import pyautogui
    except Exception as exc:
        raise HandlerError(f"pyautogui unavailable: {exc}") from exc
    pyautogui.FAILSAFE = True
    return pyautogui


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
        message = err.decode(errors="replace")[:300]
        reason = _osascript_failure_reason(message)
        raise HandlerError(
            f"physical input failed rc={proc.returncode}: {message}",
            output={"reason": reason},
        )


def _osascript_failure_reason(message: str) -> str:
    lowered = message.casefold()
    if (
        "system events" in lowered
        or "not authorized" in lowered
        or "accessibility" in lowered
        or "연결이 유효하지 않습니다" in lowered
        or "not allowed assistive access" in lowered
    ):
        return "os_permission_missing"
    return "execution_failed"


def make_keyboard_type(enabled: bool, max_chars: int = 4000):
    async def keyboard_type(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        text = (
            action.payload
            or action.target
            or str((action.args or {}).get("text") or "")
            or str((action.args or {}).get("value") or "")
        )
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
        if sys.platform == "darwin":
            await _run_script(script)
            if bool(action.args.get("enter", False)):
                await _run_script('tell application "System Events" to key code 36')
        else:
            gui = _pyautogui()
            await asyncio.to_thread(gui.write, text, interval=0.01)
            if bool(action.args.get("enter", False)):
                await asyncio.to_thread(gui.press, "enter")
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
        if sys.platform == "darwin":
            await _run_script(script)
        else:
            normalized = [
                {"command": "win", "cmd": "win", "control": "ctrl", "option": "alt"}.get(item, item)
                for item in keys
            ]
            await asyncio.to_thread(_pyautogui().hotkey, *normalized)
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
        if sys.platform == "darwin":
            for _ in range(clicks):
                await _run_script(f'tell application "System Events" to click at {{{x}, {y}}}')
        else:
            button = str(action.args.get("button", "left")).lower()
            if button not in {"left", "middle", "right"}:
                raise HandlerError("mouse_click button must be left, middle, or right")
            await asyncio.to_thread(_pyautogui().click, x, y, clicks=clicks, button=button)
        return {"x": x, "y": y, "clicks": clicks}

    return mouse_click


def make_mouse_drag(enabled: bool):
    async def mouse_drag(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        try:
            start_x = int(action.args.get("start_x"))
            start_y = int(action.args.get("start_y"))
            end_x = int(action.args.get("end_x"))
            end_y = int(action.args.get("end_y"))
        except (TypeError, ValueError) as exc:
            raise HandlerError("mouse_drag requires start_x, start_y, end_x, end_y") from exc
        duration = max(0.1, min(float(action.args.get("duration", 0.5)), 5.0))
        button = str(action.args.get("button", "left")).lower()
        if button not in {"left", "middle", "right"}:
            raise HandlerError("mouse_drag button must be left, middle, or right")
        gui = _pyautogui()
        await asyncio.to_thread(gui.moveTo, start_x, start_y, duration=0.2)
        await asyncio.to_thread(gui.dragTo, end_x, end_y, duration=duration, button=button)
        return {
            "start": {"x": start_x, "y": start_y},
            "end": {"x": end_x, "y": end_y},
            "duration": duration,
            "button": button,
        }

    return mouse_drag


def make_mouse_move(enabled: bool):
    async def mouse_move(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        try:
            x = int(action.args.get("x"))
            y = int(action.args.get("y"))
        except (TypeError, ValueError) as exc:
            raise HandlerError("mouse_move requires integer args x and y") from exc
        duration = max(0.0, min(float(action.args.get("duration", 0.2)), 5.0))
        gui = _pyautogui()
        await asyncio.to_thread(gui.moveTo, x, y, duration=duration)
        return {"x": x, "y": y, "duration": duration}

    return mouse_move


def make_mouse_scroll(enabled: bool):
    async def mouse_scroll(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        amount = int(action.args.get("amount", action.args.get("clicks", 0)))
        if amount == 0 or abs(amount) > 100:
            raise HandlerError("mouse_scroll amount must be between -100 and 100, excluding 0")
        gui = _pyautogui()
        x = action.args.get("x")
        y = action.args.get("y")
        if x is not None and y is not None:
            await asyncio.to_thread(gui.moveTo, int(x), int(y), duration=0.1)
        await asyncio.to_thread(gui.scroll, amount)
        return {"amount": amount, "x": x, "y": y}

    return mouse_scroll


def make_mouse_position(enabled: bool):
    async def mouse_position(action: ClientAction) -> dict[str, Any]:
        del action
        _require_enabled(enabled)
        point = await asyncio.to_thread(_pyautogui().position)
        return {"x": int(point.x), "y": int(point.y)}

    return mouse_position


def make_key_press(enabled: bool):
    async def key_press(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        key = str(action.target or action.command or action.args.get("key") or "").strip().lower()
        presses = max(1, min(int(action.args.get("presses", 1)), 20))
        interval = max(0.0, min(float(action.args.get("interval", 0.05)), 2.0))
        if not key:
            raise HandlerError("keyboard.press requires a key")
        gui = _pyautogui()
        if key not in gui.KEYBOARD_KEYS:
            raise HandlerError(f"unsupported keyboard key: {key}")
        await asyncio.to_thread(gui.press, key, presses=presses, interval=interval)
        return {"key": key, "presses": presses, "interval": interval}

    return key_press
