"""File read/write handlers with allowed-path enforcement."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def _resolve_allowed_paths(paths: tuple[str, ...]) -> list[Path]:
    return [Path(p).expanduser().resolve() for p in paths if p.strip()]


def _resolve_target(action: ClientAction) -> Path:
    raw = (action.target or action.args.get("path") or "").strip()
    if not raw:
        raise HandlerError("missing target path")
    return Path(raw).expanduser().resolve()


def _ensure_allowed(path: Path, allowed_paths: list[Path]) -> None:
    if not allowed_paths:
        raise HandlerError("file access denied: no allowed_paths configured")
    for root in allowed_paths:
        try:
            path.relative_to(root)
            return
        except ValueError:
            continue
    raise HandlerError(f"file access denied outside allowed_paths: {path}")


def make_file_read(allowed_paths: tuple[str, ...]):
    roots = _resolve_allowed_paths(allowed_paths)

    async def file_read(action: ClientAction) -> dict[str, Any]:
        path = _resolve_target(action)
        _ensure_allowed(path, roots)
        if not path.is_file():
            raise HandlerError(f"not a file: {path}")
        max_bytes = int(action.args.get("max_bytes", 1_000_000))
        data = await asyncio.to_thread(path.read_bytes)
        truncated = len(data) > max_bytes
        text = data[:max_bytes].decode("utf-8", errors="replace")
        return {"path": str(path), "text": text, "bytes": len(data), "truncated": truncated}

    return file_read


def make_file_write(allowed_paths: tuple[str, ...], max_bytes: int = 5 * 1024 * 1024):
    roots = _resolve_allowed_paths(allowed_paths)

    async def file_write(action: ClientAction) -> dict[str, Any]:
        path = _resolve_target(action)
        _ensure_allowed(path, roots)
        content = action.payload
        if content is None:
            raise HandlerError("missing payload for file_write")

        encoded = content.encode("utf-8")
        if len(encoded) > max_bytes:
            raise HandlerError(
                f"file_write rejected: payload {len(encoded)}B > max_bytes {max_bytes}B"
            )

        mode = str(action.command or action.args.get("mode") or "write").lower()
        if mode not in {"write", "append"}:
            raise HandlerError(f"unsupported file_write command: {mode!r}")
        path.parent.mkdir(parents=True, exist_ok=True)
        if mode == "append":
            previous = await asyncio.to_thread(
                path.read_text, "utf-8"
            ) if path.exists() else ""
            new_len = len((previous + content).encode("utf-8"))
            if new_len > max_bytes:
                raise HandlerError(
                    f"file_write append rejected: would grow file to {new_len}B > {max_bytes}B"
                )
            await asyncio.to_thread(path.write_text, previous + content, "utf-8")
        else:
            await asyncio.to_thread(path.write_text, content, "utf-8")
        return {"path": str(path), "bytes": len(encoded), "mode": mode}

    return file_write
