from __future__ import annotations

from collections.abc import AsyncIterator

from app.models.messages import EventEnvelope


class RealtimeChatClient:
    """Stub realtime client. Later connect your external conversation server here."""

    async def stream_reply(self, user_text: str) -> AsyncIterator[EventEnvelope]:
        words = user_text.split()
        if not words:
            words = ["..."]

        for word in words:
            yield EventEnvelope(type="chat.delta", payload={"text": f"{word} "})

        yield EventEnvelope(type="chat.done", payload={"text": user_text})
