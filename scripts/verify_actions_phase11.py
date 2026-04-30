"""Phase 1.1 검증 스크립트.

백엔드가 보내준 SSE 4개 이벤트 fixture를 SSE 파서에 그대로 넣어서
EventEnvelope이 어떻게 변환되는지 출력한다. 모델 직렬화/역직렬화도 검증.

사용:
    .venv/bin/python -m scripts.verify_actions_phase11
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.actions.models import (
    ClientAction,
    ClientActionResult,
    ClientActionResultRequest,
    PendingClientAction,
)
from app.models.messages import EventEnvelope
from app.realtime.sse_parser import parse_conversation_stream


# ── 백엔드 스펙 fixture ─────────────────────────────────

SSE_FIXTURE_LINES: list[str] = []


def _push_event(name: str, payload: dict[str, Any]) -> None:
    SSE_FIXTURE_LINES.append(f"event: {name}")
    SSE_FIXTURE_LINES.append("data: " + json.dumps(payload, ensure_ascii=False))
    SSE_FIXTURE_LINES.append("")


# 1. action_dispatch
_push_event(
    "action_dispatch",
    {
        "action_id": "act_xxx",
        "request_id": "req_xxx",
        "action": {
            "type": "browser_control",
            "command": "scroll",
            "target": "active_tab",
            "payload": None,
            "args": {"direction": "down", "amount": "page"},
            "description": "브라우저 스크롤",
            "requires_confirm": False,
            "step_id": "s1",
        },
    },
)

# 2. action_result
_push_event(
    "action_result",
    {
        "action_id": "act_xxx",
        "request_id": "req_xxx",
        "status": "completed",
        "output": {"scroll_y": 1200},
        "error": None,
        "action": {
            "type": "browser_control",
            "command": "scroll",
            "target": "active_tab",
            "args": {"direction": "down", "amount": "page"},
            "description": "브라우저 스크롤",
            "requires_confirm": False,
            "step_id": "s1",
        },
    },
)

# 3. actions (final aggregate)
_push_event(
    "actions",
    {
        "request_id": "req_xxx",
        "total": 1,
        "items": [
            {
                "type": "browser_control",
                "command": "scroll",
                "target": "active_tab",
                "args": {"direction": "down", "amount": "page"},
                "description": "브라우저 스크롤",
                "requires_confirm": False,
                "step_id": "s1",
            }
        ],
        "results": [
            {
                "action_id": "act_xxx",
                "request_id": "req_xxx",
                "status": "completed",
                "output": {"scroll_y": 1200},
                "error": None,
            }
        ],
    },
)

# 4. assistant_done
_push_event(
    "assistant_done",
    {
        "content": "스크롤했습니다.",
        "summary": "1/1 단계 완료",
        "has_actions": True,
        "action_count": 1,
        "action_results": [
            {
                "action_id": "act_xxx",
                "request_id": "req_xxx",
                "status": "completed",
                "output": {"scroll_y": 1200},
                "error": None,
            }
        ],
    },
)


# ── Mock aiohttp Response ─────────────────────────────


class _MockContent:
    def __init__(self, lines: list[str]) -> None:
        self.lines = [line.encode("utf-8") + b"\n" for line in lines]

    def __aiter__(self):
        async def gen():
            for line in self.lines:
                yield line

        return gen()


class _MockResponse:
    def __init__(self, lines: list[str]) -> None:
        self.content = _MockContent(lines)


# ── 검증 케이스 ────────────────────────────────────────


async def verify_sse_parser() -> int:
    """백엔드 fixture → 파서 → EventEnvelope. 기대 타입과 비교."""
    expected = [
        "conversation.action_dispatch",
        "conversation.action_result",
        "conversation.actions",
        "conversation.done",
    ]
    events: list[EventEnvelope] = []
    async for envelope in parse_conversation_stream(
        _MockResponse(SSE_FIXTURE_LINES),
        is_cancelled=lambda: False,
    ):
        events.append(envelope)

    print("=" * 60)
    print("[1] SSE parser — 백엔드 fixture 4 events")
    print("=" * 60)
    for envelope in events:
        keys = list(envelope.payload.keys())
        print(f"  • {envelope.type:38s} payload keys = {keys}")

    actual_types = [e.type for e in events]
    if actual_types != expected:
        print(f"\n  ✗ FAIL: expected {expected}, got {actual_types}")
        return 1

    # assistant_done가 has_actions / action_count / action_results 통과시켜야 함
    done_payload = events[-1].payload
    for required_key in ("text", "has_actions", "action_count", "action_results"):
        if required_key not in done_payload:
            print(f"\n  ✗ FAIL: assistant_done payload missing key '{required_key}'")
            return 1
    if done_payload["action_count"] != 1 or done_payload["has_actions"] is not True:
        print("\n  ✗ FAIL: assistant_done 메타데이터가 보존되지 않음")
        return 1

    print("\n  ✓ 4 events parsed, assistant_done payload preserved")
    return 0


def verify_models() -> int:
    """OpenAPI 스키마 1:1 round-trip."""
    print()
    print("=" * 60)
    print("[2] Pydantic models round-trip")
    print("=" * 60)

    # PendingClientAction (GET /client/actions/pending 응답)
    pending_dict = {
        "contract_version": "1.0",
        "action_id": "act_xxx",
        "request_id": "req_xxx",
        "action": {
            "type": "browser_control",
            "command": "scroll",
            "target": "active_tab",
            "payload": None,
            "args": {"direction": "down", "amount": "page"},
            "description": "브라우저 스크롤",
            "requires_confirm": False,
            "step_id": "s1",
        },
    }
    pending = PendingClientAction.model_validate(pending_dict)
    if pending.model_dump() != pending_dict:
        print("  ✗ FAIL: PendingClientAction round-trip 불일치")
        return 1
    print("  ✓ PendingClientAction round-trip")

    # ClientActionResultRequest (POST /client/actions/{id}/result body)
    req = ClientActionResultRequest(
        status="completed",
        output={"scroll_y": 1200},
    )
    expected_req = {
        "contract_version": "1.0",
        "status": "completed",
        "output": {"scroll_y": 1200},
        "error": None,
    }
    if req.model_dump() != expected_req:
        print(f"  ✗ FAIL: ResultRequest. got {req.model_dump()}")
        return 1
    print("  ✓ ClientActionResultRequest serialization")

    # 모든 14 type 검증
    types = [
        "terminal", "app_control", "file_write", "file_read",
        "open_url", "browser_control", "web_search", "notify", "clipboard",
        "mouse_click", "mouse_drag", "keyboard_type", "hotkey", "screenshot",
    ]
    for t in types:
        ClientAction(type=t, description=f"test {t}")
    print(f"  ✓ ClientAction accepts all {len(types)} types")

    # 잘못된 type은 거부해야 함
    try:
        ClientAction(type="invalid_type", description="x")  # type: ignore[arg-type]
    except Exception:
        print("  ✓ ClientAction rejects unknown type")
    else:
        print("  ✗ FAIL: ClientAction이 unknown type을 통과시킴")
        return 1

    # status 4종
    for s in ("completed", "failed", "rejected", "timeout"):
        ClientActionResultRequest(status=s)
    print("  ✓ ActionResultStatus accepts all 4 values")

    return 0


def verify_event_envelope() -> int:
    """새 EventType 들이 EventEnvelope에 등록됐는지."""
    print()
    print("=" * 60)
    print("[3] EventEnvelope new types")
    print("=" * 60)

    new_types = [
        "conversation.action_dispatch",
        "conversation.action_result",
        "conversation.actions",
        "client_action.pending",
        "client_action.started",
        "client_action.completed",
        "client_action.failed",
        "client_action.rejected",
        "client_action.timeout",
        "client_action.confirm",
    ]
    for t in new_types:
        EventEnvelope(type=t, payload={})  # type: ignore[arg-type]
    print(f"  ✓ {len(new_types)} new event types accepted by EventEnvelope")

    try:
        EventEnvelope(type="not.a.real.type", payload={})  # type: ignore[arg-type]
    except Exception:
        print("  ✓ EventEnvelope rejects unknown type")
    else:
        print("  ✗ FAIL: EventEnvelope이 unknown type을 통과시킴")
        return 1

    return 0


def main() -> int:
    rc = 0
    rc |= asyncio.run(verify_sse_parser())
    rc |= verify_models()
    rc |= verify_event_envelope()

    print()
    print("=" * 60)
    if rc == 0:
        print("ALL OK — Phase 1.1 통로 정상")
    else:
        print("FAILED")
    print("=" * 60)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
