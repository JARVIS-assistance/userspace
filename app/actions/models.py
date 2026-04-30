"""Client action 모델 — JARVIS Controller OpenAPI 스키마 1:1 매핑.

dispatch 흐름:
1. Backend deepthink → action 큐에 enqueue
2. Client (이 코드) → GET /client/actions/pending → PendingClientAction 수신
3. requires_confirm이면 UI 컨펌, 아니면 즉시 핸들러 실행
4. 결과 → POST /client/actions/{action_id}/result (ClientActionResultRequest)
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── 액션 타입 ──────────────────────────────────────────

ClientActionType = Literal[
    # 논리 (I/O)
    "terminal",
    "app_control",
    "file_write",
    "file_read",
    "open_url",
    "browser_control",
    "web_search",
    "notify",
    "clipboard",
    # 물리 (입력 합성)
    "mouse_click",
    "mouse_drag",
    "keyboard_type",
    "hotkey",
    "screenshot",
]


ActionResultStatus = Literal["completed", "failed", "rejected", "timeout"]


# ── 단일 ClientAction ─────────────────────────────────


class ClientAction(BaseModel):
    """Backend가 발행하는 액션 단위 — OpenAPI ClientAction 스키마와 동일."""

    type: ClientActionType
    command: str | None = None
    target: str | None = None
    payload: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)
    description: str
    requires_confirm: bool = True
    step_id: str | None = None


# ── Polling 응답: GET /client/actions/pending ─────────


class PendingClientAction(BaseModel):
    """GET /client/actions/pending 응답 한 건."""

    contract_version: str = "1.0"
    action_id: str
    request_id: str
    action: ClientAction


# ── 결과 보고 ──────────────────────────────────────────


class ClientActionResultRequest(BaseModel):
    """POST /client/actions/{action_id}/result 요청 body."""

    contract_version: str = "1.0"
    status: ActionResultStatus
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class ClientActionResult(BaseModel):
    """POST /client/actions/{action_id}/result 응답 — SSE action_result payload와 동일 구조."""

    contract_version: str = "1.0"
    action_id: str
    request_id: str
    status: ActionResultStatus
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    action: ClientAction | None = None


__all__ = [
    "ClientActionType",
    "ActionResultStatus",
    "ClientAction",
    "PendingClientAction",
    "ClientActionResultRequest",
    "ClientActionResult",
]
