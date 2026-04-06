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
    # Error
    "error",
]


class EventEnvelope(BaseModel):
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)


class StartSessionRequest(BaseModel):
    user_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
