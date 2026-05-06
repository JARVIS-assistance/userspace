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


class ConversationManagerTests(unittest.TestCase):
    def test_done_text_restores_prefix_missing_from_delta_accumulator(self) -> None:
        async def run():
            manager = ConversationManager()
            manager.ollama = _FakeOllama()  # type: ignore[assignment]
            return [event async for event in manager.handle_stt_final("안녕?")]

        events = asyncio.run(run())
        done = next(event for event in events if event.type == "conversation.done")

        self.assertEqual(done.payload["text"], "안녕하세요!")


if __name__ == "__main__":
    unittest.main()
