"""Real-time screen capture streaming — type='screen_stream', command='start'|'stop'.

Captures the screen on a timer, downsizes/JPEG-encodes each frame, and pushes
it to the backend's /client/vision/frame endpoint so a vision-capable model
call can read the latest frame while a turn is in progress. This module only
makes streaming *possible*; the backend must separately decide when to read
and act on the latest frame (see jarvis_controller GET /client/vision/frame).
"""

from __future__ import annotations

import asyncio
import io
import sys
import time
from typing import Any

import aiohttp

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction

DEFAULT_FPS = 2.0
MAX_FPS = 10.0
DEFAULT_QUALITY = 60
DEFAULT_MAX_WIDTH = 1280


class ScreenStreamer:
    """Owns at most one running capture loop at a time."""

    def __init__(self, *, api_base: str, auth_token: str) -> None:
        self._api_base = api_base.rstrip("/")
        self._auth_token = auth_token
        self._task: asyncio.Task[None] | None = None
        self._sequence = 0

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, *, fps: float, quality: int, max_width: int) -> dict[str, Any]:
        if self.running:
            return {"command": "start", "already_running": True}
        self._sequence = 0
        self._task = asyncio.create_task(self._loop(fps=fps, quality=quality, max_width=max_width))
        return {"command": "start", "fps": fps, "quality": quality, "max_width": max_width}

    async def stop(self) -> dict[str, Any]:
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return {"command": "stop", "frames_sent": self._sequence}

    async def _loop(self, *, fps: float, quality: int, max_width: int) -> None:
        interval = 1.0 / fps
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10.0, connect=5.0)
        ) as session:
            while True:
                started = time.monotonic()
                try:
                    frame_b64, width, height = await asyncio.to_thread(
                        _capture_frame, quality=quality, max_width=max_width
                    )
                    self._sequence += 1
                    await self._push(session, frame_b64, width, height)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Best-effort streaming: one bad frame shouldn't kill the loop.
                    pass
                elapsed = time.monotonic() - started
                await asyncio.sleep(max(0.0, interval - elapsed))

    async def _push(
        self, session: aiohttp.ClientSession, frame_b64: str, width: int, height: int
    ) -> None:
        async with session.post(
            f"{self._api_base}/client/vision/frame",
            json={
                "frame_base64": frame_b64,
                "mime_type": "image/jpeg",
                "sequence": self._sequence,
                "width": width,
                "height": height,
            },
            headers={
                "Authorization": f"Bearer {self._auth_token}",
                "Content-Type": "application/json",
            },
        ) as resp:
            await resp.read()


def _capture_frame(*, quality: int, max_width: int) -> tuple[str, int, int]:
    import base64

    import pyautogui

    image = pyautogui.screenshot()
    if image.width > max_width:
        ratio = max_width / image.width
        image = image.resize((max_width, max(1, int(image.height * ratio))))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality)
    return base64.b64encode(buffer.getvalue()).decode("ascii"), image.width, image.height


def make_screen_stream(enabled: bool, *, api_base: str, auth_token: str):
    streamer = ScreenStreamer(api_base=api_base, auth_token=auth_token)

    async def screen_stream(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("screen_stream disabled by policy")
        if sys.platform not in {"darwin", "linux", "win32"}:
            raise HandlerError(f"screen_stream not supported on {sys.platform}")
        if not api_base:
            raise HandlerError("screen_stream backend api_base is not configured")

        command = str(action.command or _command_from_type(action.type) or "start").strip().lower()
        args = action.args or {}
        if command == "start":
            fps = _clamp(_to_float(args.get("fps"), DEFAULT_FPS), 0.2, MAX_FPS)
            quality = int(_clamp(_to_float(args.get("quality"), DEFAULT_QUALITY), 10, 95))
            max_width = int(_clamp(_to_float(args.get("max_width"), DEFAULT_MAX_WIDTH), 320, 3840))
            return await streamer.start(fps=fps, quality=quality, max_width=max_width)
        if command == "stop":
            return await streamer.stop()
        raise HandlerError(f"unsupported screen_stream command: {command!r}")

    return screen_stream


def _command_from_type(action_type: str) -> str | None:
    return {
        "screen.stream_start": "start",
        "screen.stream_stop": "stop",
    }.get(str(action_type).strip().lower())


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)
