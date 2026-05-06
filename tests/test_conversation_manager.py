from __future__ import annotations

import asyncio
import unittest

from app.models.messages import EventEnvelope
from app.realtime.conversation import ConversationManager


class _FakeOllama:
    async def stream_conversation(self, **kwargs):
        yield EventEnvelope(type="conversation.delta", payload={"text": "녕하세요!"})
        yield EventEnvelope(type="conversation.done", payload={"text": "안녕하세요!"})

    def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None


class _FakeOllamaDoneBeforeAction:
    async def stream_conversation(self, **kwargs):
        yield EventEnvelope(type="conversation.delta", payload={"text": "열고 있습니다."})
        yield EventEnvelope(type="conversation.done", payload={"text": "열고 있습니다."})
        yield EventEnvelope(
            type="conversation.action_dispatch",
            payload={
                "action_id": "a1",
                "request_id": "r1",
                "action": {
                    "type": "open_url",
                    "target": "about:blank",
                    "args": {},
                    "requires_confirm": False,
                },
            },
        )

    def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None


class _FakeOllamaWithIntent:
    async def stream_conversation(self, **kwargs):
        yield EventEnvelope(
            type="conversation.action_intent",
            payload={"should_act": False, "execution_mode": "no_action"},
        )
        yield EventEnvelope(type="conversation.done", payload={"text": "완료"})

    def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None


class ConversationManagerTests(unittest.TestCase):
    def test_done_text_restores_prefix_missing_from_delta_accumulator(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FakeOllama()  # type: ignore[assignment]
            return [event async for event in manager.handle_stt_final("안녕?")]

        events = asyncio.run(run())
        done = next(event for event in events if event.type == "conversation.done")

        self.assertEqual(done.payload["text"], "안녕하세요!")

    def test_action_dispatch_after_backend_done_is_forwarded_before_final_done(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FakeOllamaDoneBeforeAction()  # type: ignore[assignment]
            return [event async for event in manager.handle_stt_final("브라우저 열어줘")]

        events = asyncio.run(run())
        types = [event.type for event in events]

        self.assertIn("conversation.action_dispatch", types)
        self.assertEqual(types[-2:], ["conversation.done", "conversation.state"])

    def test_action_intent_is_forwarded(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FakeOllamaWithIntent()  # type: ignore[assignment]
            return [event async for event in manager.handle_stt_final("안녕")]

        events = asyncio.run(run())
        intent = next(event for event in events if event.type == "conversation.action_intent")

        self.assertFalse(intent.payload["should_act"])


if __name__ == "__main__":
    unittest.main()
