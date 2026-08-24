"""Screenshot handler.

target 경로를 명시하면 ScreenshotSettings.allowed_paths 안에 있어야 함.
target 없으면 임시 디렉터리에 저장 후 경로 반환.
"""

from __future__ import annotations

import asyncio
import base64
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def _resolve_allowed_paths(paths: tuple[str, ...]) -> list[Path]:
    return [Path(p).expanduser().resolve() for p in paths if p.strip()]


def _ensure_allowed(path: Path, allowed: list[Path]) -> None:
    for root in allowed:
        try:
            path.relative_to(root)
            return
        except ValueError:
            continue
    raise HandlerError(
        f"screenshot path denied (not under any allowed_paths): {path}"
    )


def make_screenshot(enabled: bool, allowed_paths: tuple[str, ...] = ()):
    roots = _resolve_allowed_paths(allowed_paths)

    async def screenshot(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("screenshot disabled by policy")

        target = str(action.target or "").strip()
        if target:
            path = Path(target).expanduser().resolve()
            _ensure_allowed(path, roots)
            path.parent.mkdir(parents=True, exist_ok=True)
        else:
            fd, name = tempfile.mkstemp(prefix="jarvis-screenshot-", suffix=".png")
            os.close(fd)
            Path(name).unlink(missing_ok=True)
            path = Path(name)

        region = action.args.get("region")
        if sys.platform == "darwin" and not region:
            cmd = ["screencapture", "-x", str(path)]
        elif sys.platform.startswith("linux") and not region:
            cmd = ["gnome-screenshot", "-f", str(path)]
        else:
            try:
                from PIL import ImageGrab
                bbox = None
                if isinstance(region, dict):
                    x = int(region.get("x", 0))
                    y = int(region.get("y", 0))
                    width = int(region.get("width", 0))
                    height = int(region.get("height", 0))
                    if width <= 0 or height <= 0:
                        raise HandlerError("screenshot region requires positive width and height")
                    bbox = (x, y, x + width, y + height)
                image = await asyncio.to_thread(ImageGrab.grab, bbox=bbox, all_screens=True)
                await asyncio.to_thread(image.save, path, "PNG")
                cmd = None
            except HandlerError:
                raise
            except Exception as exc:
                raise HandlerError(f"screenshot capture failed: {exc}") from exc

        if cmd:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise HandlerError(
                    f"screenshot failed rc={proc.returncode}: "
                    f"{err.decode(errors='replace')[:300]}"
                )
        image_bytes = path.read_bytes()
        try:
            from PIL import Image
            with Image.open(path) as captured:
                width, height = captured.size
        except Exception:
            width, height = 0, 0
        return {
            "path": str(path),
            "mime_type": "image/png",
            "image_base64": base64.b64encode(image_bytes).decode("ascii"),
            "width": width,
            "height": height,
            "bytes": len(image_bytes),
        }

    return screenshot


def make_screen_inspect(enabled: bool):
    async def screen_inspect(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("screenshot disabled by policy")
        try:
            import pyautogui
        except Exception as exc:
            raise HandlerError(f"pyautogui unavailable: {exc}") from exc
        command = str(action.command or "size").lower()
        if action.type == "screen.size":
            command = "size"
        elif action.type == "screen.pixel":
            command = "pixel"
        if command == "size":
            size = await asyncio.to_thread(pyautogui.size)
            return {"width": int(size.width), "height": int(size.height)}
        if command == "pixel":
            x = int(action.args.get("x"))
            y = int(action.args.get("y"))
            color = await asyncio.to_thread(pyautogui.pixel, x, y)
            return {"x": x, "y": y, "rgb": [int(color[0]), int(color[1]), int(color[2])]}
        raise HandlerError(f"unsupported screen inspection command: {command}")

    return screen_inspect
