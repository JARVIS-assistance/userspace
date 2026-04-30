"""Clipboard — type='clipboard'.

OpenAPI 매핑:
- command='write'(기본) | 'read'
- payload  → write할 텍스트
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


async def clipboard(action: ClientAction) -> dict[str, Any]:
    cmd = (action.command or "write").lower()

    if cmd == "write":
        text = action.payload or ""
        await _write(text)
        return {"action": "write", "length": len(text)}

    if cmd == "read":
        text = await _read()
        return {"action": "read", "text": text}

    raise HandlerError(f"unknown clipboard command: {action.command!r}")


async def _write(text: str) -> None:
    if sys.platform == "darwin":
        proc = await asyncio.create_subprocess_exec(
            "pbcopy",
            stdin=asyncio.subprocess.PIPE,
        )
        await proc.communicate(input=text.encode("utf-8"))
        if proc.returncode != 0:
            raise HandlerError(f"pbcopy failed (rc={proc.returncode})")
        return

    if sys.platform.startswith("linux"):
        for tool in (["xclip", "-selection", "clipboard"], ["xsel", "-b", "-i"]):
            try:
                proc = await asyncio.create_subprocess_exec(
                    *tool,
                    stdin=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.communicate(input=text.encode("utf-8"))
                if proc.returncode == 0:
                    return
            except FileNotFoundError:
                continue
        raise HandlerError("clipboard write requires xclip or xsel on Linux")

    raise HandlerError(f"clipboard not supported on {sys.platform}")


async def _read() -> str:
    if sys.platform == "darwin":
        proc = await asyncio.create_subprocess_exec(
            "pbpaste", stdout=asyncio.subprocess.PIPE
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            raise HandlerError(f"pbpaste failed (rc={proc.returncode})")
        return out.decode("utf-8", errors="replace")

    if sys.platform.startswith("linux"):
        for tool in (["xclip", "-selection", "clipboard", "-o"], ["xsel", "-b", "-o"]):
            try:
                proc = await asyncio.create_subprocess_exec(
                    *tool,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                out, _ = await proc.communicate()
                if proc.returncode == 0:
                    return out.decode("utf-8", errors="replace")
            except FileNotFoundError:
                continue
        raise HandlerError("clipboard read requires xclip or xsel on Linux")

    raise HandlerError(f"clipboard not supported on {sys.platform}")
