"""ActionDispatcher — type별 핸들러 라우팅 + requires_confirm 게이트 + 생명주기 이벤트.

흐름:
1. dispatch(pending) 호출
2. client_action.started 이벤트 emit
3. requires_confirm=true면:
   - client_action.pending emit (UI에 컨펌 모달 띄우는 신호)
   - asyncio.Future로 응답 대기 (confirm_timeout_sec)
   - 거절/타임아웃 → client_action.rejected, return ('rejected', ...)
4. 핸들러 미등록 → client_action.failed, return ('failed', ..., 'no handler')
5. 핸들러 실행:
   - 정상 dict → client_action.completed, return ('completed', output, None)
   - HandlerError → client_action.failed, return ('failed', {}, msg)
   - 기타 예외 → client_action.failed, return ('failed', {}, repr(e))
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.actions.handlers.base import Handler, HandlerError
from app.actions.models import ActionResultStatus, PendingClientAction
from app.models.messages import EventEnvelope

logger = logging.getLogger(__name__)

EmitCallback = Callable[[EventEnvelope], Awaitable[None]]


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class ConfirmDecision:
    accepted: bool
    reason: str | None = None
    timed_out: bool = False


class ActionDispatcher:
    def __init__(
        self,
        *,
        emit: EmitCallback,
        confirm_timeout_sec: float = 30.0,
        enabled_types: set[str] | None = None,
        force_confirm_types: set[str] | None = None,
        enabled_capabilities: set[str] | None = None,
        force_confirm_capabilities: set[str] | None = None,
    ) -> None:
        self._emit = emit
        self._handlers: dict[str, Handler] = {}
        self._pending_confirms: dict[str, asyncio.Future[ConfirmDecision]] = {}
        self._confirm_timeout = confirm_timeout_sec
        self._enabled_types = enabled_types
        self._force_confirm_types = force_confirm_types or set()
        self._enabled_capabilities = enabled_capabilities
        self._force_confirm_capabilities = force_confirm_capabilities or set()

    # ── 핸들러 등록 ────────────────────────────────────

    def register(self, action_type: str, handler: Handler) -> None:
        self._handlers[action_type] = handler

    def has_handler(self, action_type: str) -> bool:
        return action_type in self._handlers

    def clear_handlers(self) -> None:
        """policy 변경 시 핸들러 전부 비우고 다시 등록하기 위함."""
        self._handlers.clear()

    # ── 정책 hot-apply ─────────────────────────────────

    def set_policy(
        self,
        *,
        enabled_types: set[str] | None,
        force_confirm_types: set[str],
        enabled_capabilities: set[str] | None = None,
        force_confirm_capabilities: set[str] | None = None,
    ) -> None:
        """WS 끊김 없이 정책 업데이트."""
        self._enabled_types = enabled_types
        self._force_confirm_types = set(force_confirm_types)
        self._enabled_capabilities = enabled_capabilities
        self._force_confirm_capabilities = set(force_confirm_capabilities or set())

    # ── 컨펌 ──────────────────────────────────────────

    def confirm(self, action_id: str, accepted: bool, reason: str | None = None) -> bool:
        """UI가 client_action.confirm을 보낼 때 호출. 매칭되는 액션이 있으면 True."""
        fut = self._pending_confirms.get(action_id)
        if fut is None or fut.done():
            return False
        fut.set_result(ConfirmDecision(accepted=accepted, reason=reason))
        return True

    def cancel_all_pending_confirms(self, reason: str = "websocket disconnected") -> None:
        """WS 끊길 때 호출 — 대기중인 컨펌 모두 거절 처리."""
        for fut in self._pending_confirms.values():
            if not fut.done():
                fut.set_result(ConfirmDecision(accepted=False, reason=reason))
        self._pending_confirms.clear()

    # ── 메인 dispatch ──────────────────────────────────

    async def dispatch(
        self, pending: PendingClientAction
    ) -> tuple[ActionResultStatus, dict[str, Any], str | None]:
        action = pending.action
        action_type = str(action.type)

        await self._safe_emit(EventEnvelope(
            type="client_action.started",
            payload={
                "action_id": pending.action_id,
                "request_id": pending.request_id,
                "type": action_type,
                "description": action.description,
                "requires_confirm": self._requires_confirm(action),
                "timestamp": _now_ms(),
            },
        ))

        capability = self._capability(action)
        if not self._is_enabled(action_type, capability):
            err = f"action disabled by policy: {capability or action_type!r}"
            await self._safe_emit(EventEnvelope(
                type="client_action.failed",
                payload={
                    "action_id": pending.action_id,
                    "type": action_type,
                    "description": action.description,
                    "action": action.model_dump(),
                    "error": err,
                    "reason": "policy_disabled",
                    "timestamp": _now_ms(),
                },
            ))
            return "failed", {}, err

        if self._requires_confirm(action):
            decision = await self._await_confirm(pending)
            if not decision.accepted:
                status: ActionResultStatus = "timeout" if decision.timed_out else "rejected"
                event_type = "client_action.timeout" if decision.timed_out else "client_action.rejected"
                err = "user confirmation timed out" if decision.timed_out else (
                    decision.reason or "user rejected confirmation"
                )
                await self._safe_emit(EventEnvelope(
                    type=event_type,
                    payload={
                        "action_id": pending.action_id,
                        "type": action_type,
                        "error": err,
                        "reason": "timeout" if decision.timed_out else "confirmation_rejected",
                        "timestamp": _now_ms(),
                    },
                ))
                return status, {}, err

        handler = self._handlers.get(action_type)
        if handler is None:
            err = f"no handler registered for type={action_type!r}"
            logger.info("dispatch: %s (action_id=%s)", err, pending.action_id)
            await self._safe_emit(EventEnvelope(
                type="client_action.failed",
                payload={
                    "action_id": pending.action_id,
                    "type": action_type,
                    "description": action.description,
                    "action": action.model_dump(),
                    "error": err,
                    "reason": "handler_unsupported",
                    "timestamp": _now_ms(),
                },
            ))
            return "failed", {}, err

        try:
            output = await handler(action)
        except HandlerError as e:
            err = str(e)
            output = dict(getattr(e, "output", {}) or {})
            logger.info("dispatch handler error (%s): %s", action_type, err)
            await self._safe_emit(EventEnvelope(
                type="client_action.failed",
                payload={
                    "action_id": pending.action_id,
                    "type": action_type,
                    "description": action.description,
                    "action": action.model_dump(),
                    "output": output,
                    "error": err,
                    "reason": output.get("reason", "execution_failed"),
                    "timestamp": _now_ms(),
                },
            ))
            return "failed", output, err
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            logger.exception("dispatch unhandled exception in %s: %s", action_type, err)
            await self._safe_emit(EventEnvelope(
                type="client_action.failed",
                payload={
                    "action_id": pending.action_id,
                    "type": action_type,
                    "description": action.description,
                    "action": action.model_dump(),
                    "error": err,
                    "reason": "execution_failed",
                    "timestamp": _now_ms(),
                },
            ))
            return "failed", {}, err

        if not isinstance(output, dict):
            output = {"value": output}

        await self._safe_emit(EventEnvelope(
            type="client_action.completed",
            payload={
                "action_id": pending.action_id,
                "type": action_type,
                "output": output,
                "timestamp": _now_ms(),
            },
        ))
        return "completed", output, None

    # ── internal ──────────────────────────────────────

    def _requires_confirm(self, action: Any) -> bool:
        capability = self._capability(action)
        return (
            bool(action.requires_confirm)
            or str(action.type) in self._force_confirm_types
            or bool(capability and capability in self._force_confirm_capabilities)
        )

    def _is_enabled(self, action_type: str, capability: str | None) -> bool:
        if self._enabled_types is None and self._enabled_capabilities is None:
            return True
        if capability and self._enabled_capabilities is not None:
            return capability in self._enabled_capabilities
        if self._enabled_types is not None and action_type in self._enabled_types:
            return True
        return False

    def _capability(self, action: Any) -> str | None:
        action_type = str(getattr(action, "type", ""))
        command = str(getattr(action, "command", "") or "").strip().lower()
        dotted_command = command.replace("_", ".")
        if action_type.startswith("browser."):
            return action_type
        if action_type in {
            "app.open",
            "app.focus",
            "app.close",
            "keyboard.type",
            "keyboard.hotkey",
            "mouse.click",
            "mouse.drag",
            "screen.screenshot",
            "clipboard.copy",
            "clipboard.paste",
            "terminal.run",
            "notification.show",
            "calendar.open",
            "calendar.create",
            "calendar.update",
            "calendar.delete",
            "todo.create",
            "todo.update",
            "todo.delete",
        }:
            return action_type
        if action_type == "browser":
            if dotted_command.startswith("browser."):
                return dotted_command
            browser_commands = {
                "open": "browser.open",
                "navigate": "browser.navigate",
                "search": "browser.search",
                "extract_dom": "browser.extract_dom",
                "extract.dom": "browser.extract_dom",
                "click": "browser.click",
                "type": "browser.type",
                "select_result": "browser.select_result",
                "select.result": "browser.select_result",
            }
            if command in browser_commands:
                return browser_commands[command]
            if dotted_command in browser_commands:
                return browser_commands[dotted_command]
            return "browser.open" if not dotted_command else f"browser.{dotted_command}"
        if action_type == "browser_control":
            return {
                "extract_dom": "browser.extract_dom",
                "click_element": "browser.click",
                "type_element": "browser.type",
                "select_result": "browser.select_result",
                "open": "browser.open",
                "open_url": "browser.navigate",
                "navigate": "browser.navigate",
            }.get(command)
        if action_type == "open_url":
            args = getattr(action, "args", None)
            if isinstance(args, dict) and isinstance(args.get("query"), str) and args["query"].strip():
                return "browser.search"
            return "browser.navigate"
        if action_type == "app_control":
            return {
                "open": "app.open",
                "focus": "app.focus",
                "close": "app.close",
            }.get(command, "app.open")
        if action_type == "keyboard_type":
            return "keyboard.type"
        if action_type == "hotkey":
            return "keyboard.hotkey"
        if action_type == "mouse_click":
            return "mouse.click"
        if action_type == "mouse_drag":
            return "mouse.drag"
        if action_type == "terminal":
            return "terminal.run"
        if action_type == "file_write":
            return "file.write"
        if action_type == "file_read":
            return "file.read"
        if action_type == "screenshot":
            return "screen.screenshot"
        if action_type == "todo":
            todo_commands = {
                "create": "todo.create",
                "add": "todo.create",
                "new": "todo.create",
                "update": "todo.update",
                "patch": "todo.update",
                "complete": "todo.update",
                "done": "todo.update",
                "delete": "todo.delete",
                "remove": "todo.delete",
            }
            return todo_commands.get(command, "todo.create")
        return None

    async def _await_confirm(self, pending: PendingClientAction) -> ConfirmDecision:
        action_id = pending.action_id
        fut: asyncio.Future[ConfirmDecision] = asyncio.get_running_loop().create_future()
        self._pending_confirms[action_id] = fut

        asyncio.create_task(
            self._safe_emit(
                EventEnvelope(
                    type="client_action.pending",
                    payload={
                        "action_id": action_id,
                        "request_id": pending.request_id,
                        "action": pending.action.model_dump(),
                        "timeout_sec": self._confirm_timeout,
                        "timestamp": _now_ms(),
                    },
                )
            ),
            name=f"client_action_pending_{action_id}",
        )

        try:
            return await asyncio.wait_for(fut, timeout=self._confirm_timeout)
        except asyncio.TimeoutError:
            logger.warning("confirm timeout for action_id=%s", action_id)
            return ConfirmDecision(accepted=False, timed_out=True)
        finally:
            self._pending_confirms.pop(action_id, None)

    async def _safe_emit(self, envelope: EventEnvelope) -> None:
        """emit 콜백이 실패해도 dispatch는 계속 진행 (WS 끊김 등)."""
        try:
            await self._emit(envelope)
        except Exception as e:
            logger.warning("dispatcher emit failed (%s): %s", envelope.type, e)
