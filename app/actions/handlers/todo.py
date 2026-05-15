from __future__ import annotations

from typing import Any
from urllib.parse import quote

import aiohttp

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def make_todo(api_base: str, auth_token: str):
    async def todo(action: ClientAction) -> dict[str, Any]:
        if not api_base:
            raise HandlerError("todo api base is not configured")
        if not auth_token:
            raise HandlerError("todo auth token is missing")

        command = _command(action)
        if command in {"create", "add", "new", ""}:
            return await _create_todo(api_base, auth_token, action)
        if command in {"complete", "done", "completed"}:
            return await _patch_todo(api_base, auth_token, action, {"status": "completed"})
        if command in {"cancel", "cancelled"}:
            return await _patch_todo(api_base, auth_token, action, {"status": "cancelled"})
        if command in {"archive", "archived"}:
            return await _patch_todo(api_base, auth_token, action, {"status": "archived"})
        if command in {"delete", "remove"}:
            return await _delete_todo(api_base, auth_token, action)

        raise HandlerError(f"unsupported todo command: {command!r}")

    return todo


async def _create_todo(api_base: str, auth_token: str, action: ClientAction) -> dict[str, Any]:
    args = action.args if isinstance(action.args, dict) else {}
    title = _first_string(
        args.get("title"),
        args.get("text"),
        args.get("task"),
        action.target,
        action.payload,
        _title_from_description(action.description),
    )
    if not title:
        raise HandlerError("todo title is missing")

    payload: dict[str, Any] = {
        "title": title,
        "priority": _priority(args.get("priority")),
        "timezone": _first_string(args.get("timezone")) or "Asia/Seoul",
        "metadata": {"source": "client_action"},
    }
    for source_key, target_key in (
        ("description", "description"),
        ("due_at", "due_at"),
        ("remind_at", "remind_at"),
        ("calendar_provider", "calendar_provider"),
        ("calendar_id", "calendar_id"),
        ("calendar_event_id", "calendar_event_id"),
    ):
        value = _first_string(args.get(source_key))
        if value:
            payload[target_key] = value

    data = await _request(api_base, auth_token, "POST", "/todos", payload)
    return {"todo": data, "title": title, "command": "create"}


async def _patch_todo(
    api_base: str,
    auth_token: str,
    action: ClientAction,
    patch: dict[str, Any],
) -> dict[str, Any]:
    todo_id = _todo_id(action)
    if not todo_id:
        raise HandlerError("todo_id is missing")
    data = await _request(
        api_base,
        auth_token,
        "PATCH",
        f"/todos/{quote(todo_id, safe='')}",
        patch,
    )
    return {"todo": data, "todo_id": todo_id, "command": "patch"}


async def _delete_todo(api_base: str, auth_token: str, action: ClientAction) -> dict[str, Any]:
    todo_id = _todo_id(action)
    if not todo_id:
        raise HandlerError("todo_id is missing")
    data = await _request(
        api_base,
        auth_token,
        "DELETE",
        f"/todos/{quote(todo_id, safe='')}",
        None,
    )
    return {"todo": data, "todo_id": todo_id, "command": "delete"}


async def _request(
    api_base: str,
    auth_token: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
) -> Any:
    timeout = aiohttp.ClientTimeout(total=30, connect=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            method,
            f"{api_base.rstrip('/')}{path}",
            json=payload,
            headers={
                "Authorization": f"Bearer {auth_token}",
                "Content-Type": "application/json",
            },
        ) as resp:
            data = await _read_response(resp)
            if resp.status < 200 or resp.status >= 300:
                message = _error_message(data) or f"todo api HTTP {resp.status}"
                raise HandlerError(message, {"status": resp.status, "response": data})
            return data


async def _read_response(resp: aiohttp.ClientResponse) -> Any:
    if resp.status == 204:
        return {}
    content_type = resp.headers.get("content-type", "")
    if "application/json" in content_type:
        return await resp.json()
    text = await resp.text()
    return {"text": text} if text else {}


def _error_message(data: Any) -> str:
    if isinstance(data, dict):
        value = data.get("detail") or data.get("message") or data.get("error")
        return str(value) if value else ""
    return ""


def _command(action: ClientAction) -> str:
    command = str(action.command or "").strip().lower()
    return command.replace("todo.", "")


def _todo_id(action: ClientAction) -> str:
    args = action.args if isinstance(action.args, dict) else {}
    return _first_string(args.get("todo_id"), args.get("id"), action.target)


def _priority(value: Any) -> int:
    try:
        return min(5, max(1, int(value)))
    except Exception:
        return 3


def _first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _title_from_description(description: str) -> str:
    text = description.strip()
    prefixes = (
        "Create todo:",
        "Create Todo:",
        "TODO:",
        "Todo:",
        "todo:",
        "할일에",
        "할 일에",
        "할일",
        "할 일",
    )
    changed = True
    while changed:
        changed = False
        for prefix in prefixes:
            if text.startswith(prefix):
                text = text[len(prefix):].strip()
                changed = True
                break
    for suffix in (
        "까지 이거 추가해줘",
        "까지 이거 추가해 줘",
        "까지 추가해줘",
        "까지 추가해 줘",
        "추가해줘",
        "추가해 줘",
        "추가",
    ):
        if text.endswith(suffix):
            text = text[: -len(suffix)].strip()
            break
    return text
