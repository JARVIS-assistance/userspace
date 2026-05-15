from __future__ import annotations

import asyncio
import unittest

from app.models.messages import EventEnvelope
from app.realtime.conversation import ConversationManager, INITIAL_GREETING_TEXT


class _FakeOllama:
    async def stream_conversation(self, **kwargs):
        yield EventEnvelope(type="conversation.delta", payload={"text": "녕하세요!"})
        yield EventEnvelope(type="conversation.done", payload={"text": "안녕하세요!"})

    def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None


class _FailingOllama:
    async def stream_conversation(self, **kwargs):
        raise AssertionError("initial greeting should not call the LLM backend")
        yield

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


class _FakeOllamaActionAfterBadRealtime:
    async def stream_conversation(self, **kwargs):
        yield EventEnvelope(type="conversation.delta", payload={"text": "죄송합니다, 못 합니다."})
        yield EventEnvelope(
            type="conversation.action_intent",
            payload={"should_act": True, "execution_mode": "direct"},
        )
        yield EventEnvelope(type="conversation.delta", payload={"text": "잠시만요!"})
        yield EventEnvelope(type="conversation.delta", payload={"text": "요청하신 작업 시작할게요"})
        yield EventEnvelope(
            type="conversation.done",
            payload={"text": "요청한 작업을 실행했습니다.", "has_actions": True},
        )

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
        self.assertTrue(str(done.payload["request_id"]).startswith("turn-"))

    def test_each_turn_uses_a_new_request_id(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FakeOllama()  # type: ignore[assignment]
            first = [event async for event in manager.handle_stt_final("첫 번째")]
            second = [event async for event in manager.handle_stt_final("두 번째")]
            return first, second

        first, second = asyncio.run(run())
        first_done = next(event for event in first if event.type == "conversation.done")
        second_done = next(event for event in second if event.type == "conversation.done")

        self.assertNotEqual(first_done.payload["request_id"], second_done.payload["request_id"])

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

    def test_action_intent_does_not_clear_assistant_delta_text(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FakeOllamaActionAfterBadRealtime()  # type: ignore[assignment]
            return [event async for event in manager.handle_stt_final("브라우저 열어줘")]

        events = asyncio.run(run())
        done = next(event for event in events if event.type == "conversation.done")

        self.assertEqual(
            done.payload["text"],
            "죄송합니다, 못 합니다.잠시만요!요청하신 작업 시작할게요",
        )

    def test_initial_greeting_generates_without_user_turn(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FailingOllama()  # type: ignore[assignment]
            events = [
                event async for event in manager.handle_initial_greeting()
            ]
            return manager, events

        manager, events = asyncio.run(run())
        types = [event.type for event in events]
        done = next(event for event in events if event.type == "conversation.done")

        self.assertNotIn("conversation.user", types)
        self.assertIn("conversation.delta", types)
        self.assertEqual(done.payload["text"], INITIAL_GREETING_TEXT)
        self.assertEqual(len(manager.context.history), 1)
        self.assertEqual(manager.context.history[0].role, "assistant")
        self.assertEqual(manager.context.history[0].content, INITIAL_GREETING_TEXT)


if __name__ == "__main__":
    unittest.main()
