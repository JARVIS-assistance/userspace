from __future__ import annotations

import asyncio
import unittest
import json

from app.realtime.sse_parser import parse_conversation_stream


class _FakeResponse:
    def __init__(self, lines: list[bytes]) -> None:
        self.content = _AsyncLines(lines)


class _AsyncLines:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = lines

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for line in self._lines:
            yield line


class SSEParserTests(unittest.TestCase):
    def test_preserves_leading_space_inside_delta_content(self) -> None:
        async def run():
            response = _FakeResponse(
                [
                    b"event: assistant_delta\n",
                    b'data: {"content":" hello"}\n',
                    b"\n",
                    b"event: assistant_done\n",
                    b'data: {"content":" hello"}\n',
                    b"\n",
                ]
            )
            events = [
                event
                async for event in parse_conversation_stream(
                    response, is_cancelled=lambda: False
                )
            ]
            return events

        events = asyncio.run(run())

        self.assertEqual(events[0].type, "conversation.delta")
        self.assertEqual(events[0].payload["text"], " hello")

    def test_continues_after_assistant_done_for_late_action_dispatch(self) -> None:
        async def run():
            response = _FakeResponse(
                [
                    b"event: assistant_done\n",
                    b'data: {"content":"done"}\n',
                    b"\n",
                    b"event: action_dispatch\n",
                    b'data: {"action_id":"a1","request_id":"r1","action":{"type":"open_url","target":"about:blank","args":{},"requires_confirm":false}}\n',
                    b"\n",
                ]
            )
            return [
                event
                async for event in parse_conversation_stream(
                    response, is_cancelled=lambda: False
                )
            ]

        events = asyncio.run(run())

        self.assertEqual([event.type for event in events], [
            "conversation.done",
            "conversation.action_dispatch",
        ])

    def test_passes_action_intent_events(self) -> None:
        async def run():
            response = _FakeResponse(
                [
                    b"event: action_intent\n",
                    b'data: {"should_act": false, "execution_mode": "no_action"}\n',
                    b"\n",
                ]
            )
            return [
                event
                async for event in parse_conversation_stream(
                    response, is_cancelled=lambda: False
                )
            ]

        events = asyncio.run(run())

        self.assertEqual(events[0].type, "conversation.action_intent")
        self.assertFalse(events[0].payload["should_act"])

    def test_passes_plan_step_events(self) -> None:
        async def run():
            payload = json.dumps(
                {
                    "id": "step1",
                    "status": "in_progress",
                    "title": "요청 판별",
                    "description": "요청을 분류",
                },
                ensure_ascii=False,
            ).encode("utf-8")
            response = _FakeResponse(
                [
                    b"event: plan_step\n",
                    b"data: " + payload + b"\n",
                    b"\n",
                ]
            )
            return [
                event
                async for event in parse_conversation_stream(
                    response, is_cancelled=lambda: False
                )
            ]

        events = asyncio.run(run())

        self.assertEqual(events[0].type, "conversation.plan_step")
        self.assertEqual(events[0].payload["id"], "step1")
        self.assertEqual(events[0].payload["status"], "in_progress")


if __name__ == "__main__":
    unittest.main()
