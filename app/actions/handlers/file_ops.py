"""File read/write handlers with allowed-path enforcement."""

from __future__ import annotations

import asyncio
import shutil
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


def _ensure_not_allowed_root(path: Path, allowed_paths: list[Path]) -> None:
    if path in allowed_paths:
        raise HandlerError(f"refusing to modify configured allowed root: {path}")


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


def make_file_list(allowed_paths: tuple[str, ...]):
    roots = _resolve_allowed_paths(allowed_paths)

    async def file_list(action: ClientAction) -> dict[str, Any]:
        path = _resolve_target(action)
        _ensure_allowed(path, roots)
        if not path.is_dir():
            raise HandlerError(f"not a directory: {path}")
        limit = max(1, min(int(action.args.get("limit", 200)), 1000))
        include_hidden = bool(action.args.get("include_hidden", False))

        def scan() -> list[dict[str, Any]]:
            entries: list[dict[str, Any]] = []
            for child in sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold())):
                if not include_hidden and child.name.startswith("."):
                    continue
                stat = child.stat()
                entries.append({
                    "name": child.name,
                    "path": str(child),
                    "kind": "directory" if child.is_dir() else "file",
                    "bytes": stat.st_size if child.is_file() else None,
                    "modified_at": int(stat.st_mtime * 1000),
                })
                if len(entries) >= limit:
                    break
            return entries

        entries = await asyncio.to_thread(scan)
        return {"path": str(path), "entries": entries, "count": len(entries), "limit": limit}

    return file_list


def make_file_search(allowed_paths: tuple[str, ...]):
    roots = _resolve_allowed_paths(allowed_paths)

    async def file_search(action: ClientAction) -> dict[str, Any]:
        path = _resolve_target(action)
        _ensure_allowed(path, roots)
        if not path.is_dir():
            raise HandlerError(f"not a directory: {path}")
        query = str(action.args.get("query") or action.payload or "").strip().casefold()
        if not query:
            raise HandlerError("file.search requires a query")
        limit = max(1, min(int(action.args.get("limit", 100)), 500))
        max_depth = max(0, min(int(action.args.get("max_depth", 5)), 20))

        def search() -> list[dict[str, Any]]:
            matches: list[dict[str, Any]] = []
            for child in path.rglob("*"):
                try:
                    depth = len(child.relative_to(path).parts) - 1
                    if depth > max_depth or query not in child.name.casefold():
                        continue
                    matches.append({
                        "name": child.name,
                        "path": str(child),
                        "kind": "directory" if child.is_dir() else "file",
                    })
                    if len(matches) >= limit:
                        break
                except (OSError, ValueError):
                    continue
            return matches

        matches = await asyncio.to_thread(search)
        return {"path": str(path), "query": query, "matches": matches, "count": len(matches)}

    return file_search


def make_file_manage(allowed_paths: tuple[str, ...]):
    roots = _resolve_allowed_paths(allowed_paths)

    async def file_manage(action: ClientAction) -> dict[str, Any]:
        command = str(action.command or action.args.get("operation") or "").strip().lower()
        if not command and action.type.startswith("file."):
            command = action.type.split(".", 1)[1]
        source = _resolve_target(action)
        _ensure_allowed(source, roots)

        if command in {"mkdir", "create_directory"}:
            await asyncio.to_thread(source.mkdir, parents=True, exist_ok=True)
            return {"path": str(source), "operation": "mkdir"}

        if command in {"move", "rename"}:
            _ensure_not_allowed_root(source, roots)
            raw_destination = str(action.args.get("destination") or "").strip()
            if not raw_destination:
                raise HandlerError("missing destination path")
            destination = Path(raw_destination).expanduser().resolve()
            _ensure_allowed(destination, roots)
            if not source.exists():
                raise HandlerError(f"source does not exist: {source}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(shutil.move, str(source), str(destination))
            return {
                "source": str(source),
                "destination": str(destination),
                "operation": "move",
            }

        if command in {"delete", "remove"}:
            _ensure_not_allowed_root(source, roots)
            if not source.exists():
                raise HandlerError(f"path does not exist: {source}")
            recursive = bool(action.args.get("recursive", False))
            if source.is_dir():
                if not recursive:
                    await asyncio.to_thread(source.rmdir)
                else:
                    await asyncio.to_thread(shutil.rmtree, source)
            else:
                await asyncio.to_thread(source.unlink)
            return {"path": str(source), "operation": "delete", "recursive": recursive}

        raise HandlerError(f"unsupported file_manage command: {command!r}")

    return file_manage
