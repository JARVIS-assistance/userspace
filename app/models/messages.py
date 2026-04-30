from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


EventType = Literal[
    # Chat events (legacy)
    "chat.delta",
    "chat.done",
    # Action events
    "action.request",
    "action.result",
    # STT events
    "stt.start",
    "stt.audio.chunk",
    "stt.stop",
    "stt.partial",
    "stt.final",
    "stt.state",
    # Conversation events (real-time with barge-in)
    "conversation.state",
    "conversation.user",
    "conversation.delta",
    "conversation.done",
    "conversation.barge_in",
    "conversation.speech_end",
    "conversation.classification",
    "conversation.thinking",
    "conversation.plan_step",
    "conversation.error",
    "conversation.reset",
    # Conversation action events (SSE pass-through, UI display only)
    "conversation.action_dispatch",
    "conversation.action_result",
    "conversation.actions",
    # Cancel: UI → server / server → UI
    "conversation.cancel",       # UI → server: 현재 응답/추론 중단 요청
    "conversation.cancelled",    # server → UI: 중단 완료 알림
    # Client action lifecycle (server-side dispatcher → UI)
    "client_action.pending",       # 컨펌 대기 (requires_confirm=true)
    "client_action.started",       # 실행 시작 알림
    "client_action.completed",     # 성공
    "client_action.failed",        # 실패
    "client_action.rejected",      # 사용자 거절
    "client_action.timeout",       # 타임아웃
    # Client action lifecycle (UI → server)
    "client_action.confirm",       # {action_id, accepted, reason?}
    # Config (UI ↔ server)
    "config.actions.get",          # UI → server: 현재 actions 정책 요청
    "config.actions.set",          # UI → server: actions 정책 패치
    "config.actions.value",        # server → UI: 현재/갱신된 actions 정책
    "config.actions.error",        # server → UI: 저장 실패 사유
    # Error
    "error",
]


class EventEnvelope(BaseModel):
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)


class StartSessionRequest(BaseModel):
    user_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
