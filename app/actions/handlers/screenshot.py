"""Screenshot handler.

target 경로를 명시하면 ScreenshotSettings.allowed_paths 안에 있어야 함.
target 없으면 임시 디렉터리에 저장 후 경로 반환.
"""

from __future__ import annotations

import asyncio
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

        if sys.platform == "darwin":
            cmd = ["screencapture", "-x", str(path)]
        elif sys.platform.startswith("linux"):
            cmd = ["gnome-screenshot", "-f", str(path)]
        else:
            raise HandlerError(f"screenshot not supported on {sys.platform}")

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
        return {"path": str(path)}

    return screenshot
