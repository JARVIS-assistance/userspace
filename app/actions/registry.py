from __future__ import annotations

from typing import Any

from app.models.messages import EventEnvelope


class ActionRegistry:
    """Allowlist-based action executor."""

    def __init__(self) -> None:
        self._actions = {
            "ping": self._ping,
        }

    async def execute(self, name: str, args: dict[str, Any]) -> EventEnvelope:
        fn = self._actions.get(name)
        if fn is None:
            return EventEnvelope(
                type="error",
                payload={"message": f"Unknown action: {name}"},
            )
        return await fn(args)

    async def _ping(self, args: dict[str, Any]) -> EventEnvelope:
        return EventEnvelope(
            type="action.result",
            payload={"name": "ping", "args": args, "ok": True},
        )
