"""SSE 응답 파서 — JARVIS Core /conversation/stream 이벤트를 EventEnvelope로 변환.

지원 이벤트:
- meta            → 무시
- classification  → conversation.classification
- thinking        → conversation.thinking
- plan_step       → conversation.plan_step
- assistant_delta → conversation.delta
- assistant_done  → conversation.done (payload: text + has_actions / action_count / action_results)
- error           → conversation.error
- action_dispatch → conversation.action_dispatch    (action 발행 알림)
- action_result   → conversation.action_result      (action 결과 알림)
- actions         → conversation.actions            (최종 집계)
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Callable

import aiohttp

from app.models.messages import EventEnvelope

logger = logging.getLogger(__name__)


# event 이름 → EventEnvelope.type 매핑 (1:1 passthrough)
_PASSTHROUGH_EVENTS: dict[str, str] = {
    "classification": "conversation.classification",
    "thinking": "conversation.thinking",
    "plan_step": "conversation.plan_step",
    "action_dispatch": "conversation.action_dispatch",
    "action_result": "conversation.action_result",
    "actions": "conversation.actions",
}


async def parse_conversation_stream(
    response: aiohttp.ClientResponse,
    is_cancelled: Callable[[], bool],
) -> AsyncIterator[EventEnvelope]:
    """Parse SSE stream and yield EventEnvelopes."""
    current_event = ""

    async for raw_line in response.content:
        if is_cancelled():
            break

        line = raw_line.decode("utf-8", errors="replace").strip()

        if not line:
            current_event = ""
            continue

        if line.startswith("event:"):
            current_event = line[len("event:") :].strip()
            continue

        if not line.startswith("data:"):
            continue

        data_str = line[len("data:") :].strip()
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            continue

        if current_event == "meta":
            continue

        # 1:1 passthrough events
        if current_event in _PASSTHROUGH_EVENTS:
            yield EventEnvelope(
                type=_PASSTHROUGH_EVENTS[current_event],
                payload=data if isinstance(data, dict) else {"data": data},
            )
            continue

        if current_event == "assistant_delta":
            content = data.get("content", "")
            if content:
                yield EventEnvelope(
                    type="conversation.delta",
                    payload={"text": content},
                )
            continue

        if current_event == "assistant_done":
            # data: {content, summary?, has_actions?, action_count?, action_results?}
            payload: dict = {"text": data.get("content", "")}
            for key in ("summary", "has_actions", "action_count", "action_results"):
                if key in data:
                    payload[key] = data[key]
            yield EventEnvelope(type="conversation.done", payload=payload)
            return

        if current_event == "error":
            yield EventEnvelope(
                type="conversation.error",
                payload={"message": data.get("content", "unknown error")},
            )
            return
