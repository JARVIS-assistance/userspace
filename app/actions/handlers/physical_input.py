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
        args = action.args or {}
        raw = str(action.command or args.get("keys") or action.target or "").lower()
        keys = [k.strip() for k in raw.replace("+", ",").split(",") if k.strip()]
        if not keys:
            raise HandlerError("missing hotkey keys")
        modifiers = [k for k in keys[:-1] if k in {"command", "cmd", "control", "ctrl", "option", "alt", "shift"}]
        key = keys[-1]
        using = _applescript_modifier_clause(modifiers)
        escaped_key = _escape_applescript(key)

        duration = _hold_duration(args.get("duration_seconds"))
        if duration > 0:
            if sys.platform == "darwin":
                await _run_script(f'tell application "System Events" to key down "{escaped_key}"{using}')
                await asyncio.sleep(duration)
                await _run_script(f'tell application "System Events" to key up "{escaped_key}"{using}')
            else:
                gui = _pyautogui()
                normalized = [
                    {"command": "win", "cmd": "win", "control": "ctrl", "option": "alt"}.get(item, item)
                    for item in keys
                ]
                for held_key in normalized:
                    await asyncio.to_thread(gui.keyDown, held_key)
                try:
                    await asyncio.sleep(duration)
                finally:
                    for held_key in reversed(normalized):
                        await asyncio.to_thread(gui.keyUp, held_key)
            return {"keys": keys, "duration_seconds": duration}

        script = (
            'tell application "System Events" to keystroke '
            f'"{escaped_key}"{using}'
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


def _applescript_modifier_clause(modifiers: list[str]) -> str:
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
    return f" using {{{', '.join(applescript_mods)}}}" if applescript_mods else ""


def _hold_duration(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        duration = float(value)
    except (TypeError, ValueError):
        return 0.0
    if duration <= 0:
        return 0.0
    return min(duration, 30.0)


_MOUSE_BUTTONS = {"left", "right", "middle"}


def make_mouse_click(enabled: bool):
    async def mouse_click(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        args = action.args or {}
        try:
            x = int(args.get("x"))
            y = int(args.get("y"))
        except (TypeError, ValueError) as e:
            raise HandlerError("mouse_click requires integer args x and y") from e
        clicks = int(args.get("clicks", 1))
        if clicks < 1 or clicks > 3:
            raise HandlerError("mouse_click clicks must be between 1 and 3")
        button = str(args.get("button") or "left").strip().lower()
        if button not in _MOUSE_BUTTONS:
            raise HandlerError(f"mouse_click button must be one of {sorted(_MOUSE_BUTTONS)}")

        pyautogui = _pyautogui()
        try:
            await asyncio.to_thread(pyautogui.click, x, y, clicks=clicks, button=button)
        except Exception as e:
            raise HandlerError(f"mouse_click failed: {e}") from e
        return {"x": x, "y": y, "clicks": clicks, "button": button}

    return mouse_click


def make_mouse_move(enabled: bool):
    async def mouse_move(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        args = action.args or {}
        try:
            x = int(args.get("x"))
            y = int(args.get("y"))
        except (TypeError, ValueError) as e:
            raise HandlerError("mouse_move requires integer args x and y") from e
        duration = _drag_duration(args.get("duration_seconds"))

        pyautogui = _pyautogui()
        try:
            await asyncio.to_thread(pyautogui.moveTo, x, y, duration)
        except Exception as e:
            raise HandlerError(f"mouse_move failed: {e}") from e
        return {"x": x, "y": y, "duration_seconds": duration}

    return mouse_move


def make_mouse_scroll(enabled: bool):
    async def mouse_scroll(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        args = action.args or {}
        direction = str(args.get("direction") or "down").strip().lower()
        if direction not in {"up", "down", "left", "right"}:
            raise HandlerError(f"unsupported scroll direction: {direction!r}")
        try:
            amount = int(args.get("amount"))
        except (TypeError, ValueError) as e:
            raise HandlerError("mouse_scroll requires integer args.amount") from e
        if amount <= 0:
            raise HandlerError("mouse_scroll amount must be positive")

        x = args.get("x")
        y = args.get("y")
        try:
            x = int(x) if x is not None else None
            y = int(y) if y is not None else None
        except (TypeError, ValueError) as e:
            raise HandlerError("mouse_scroll args x/y must be integers when provided") from e

        pyautogui = _pyautogui()
        move_kwargs: dict[str, Any] = {}
        if x is not None and y is not None:
            move_kwargs = {"x": x, "y": y}
        signed = amount if direction in {"up", "right"} else -amount
        try:
            if direction in {"up", "down"}:
                await asyncio.to_thread(pyautogui.scroll, signed, **move_kwargs)
            else:
                await asyncio.to_thread(pyautogui.hscroll, signed, **move_kwargs)
        except Exception as e:
            raise HandlerError(f"mouse_scroll failed: {e}") from e
        return {"direction": direction, "amount": amount, "x": x, "y": y}

    return mouse_scroll


def make_mouse_drag(enabled: bool):
    async def mouse_drag(action: ClientAction) -> dict[str, Any]:
        _require_enabled(enabled)
        args = action.args or {}
        try:
            start_x = int(args.get("start_x"))
            start_y = int(args.get("start_y"))
            end_x = int(args.get("end_x"))
            end_y = int(args.get("end_y"))
        except (TypeError, ValueError) as e:
            raise HandlerError(
                "mouse_drag requires integer args start_x, start_y, end_x, end_y"
            ) from e
        duration = _drag_duration(args.get("duration_seconds"))
        button = str(args.get("button") or "left").strip().lower()
        if button not in _MOUSE_BUTTONS:
            raise HandlerError(f"mouse_drag button must be one of {sorted(_MOUSE_BUTTONS)}")

        pyautogui = _pyautogui()
        try:
            await asyncio.to_thread(pyautogui.moveTo, start_x, start_y)
            await asyncio.to_thread(pyautogui.dragTo, end_x, end_y, duration, button=button)
        except Exception as e:
            raise HandlerError(f"mouse_drag failed: {e}") from e

        return {
            "start_x": start_x,
            "start_y": start_y,
            "end_x": end_x,
            "end_y": end_y,
            "duration_seconds": duration,
            "button": button,
        }

    return mouse_drag


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


def _drag_duration(value: Any) -> float:
    try:
        duration = float(value) if value is not None else 0.3
    except (TypeError, ValueError):
        duration = 0.3
    return min(max(duration, 0.05), 5.0)
