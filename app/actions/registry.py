from __future__ import annotations

import asyncio
from typing import Any

from app.actions.os_actions import OSManager
from app.actions.web import WebBrowserManager
from app.models.messages import EventEnvelope


class ActionRegistry:
    """Allowlist-based action executor."""

    def __init__(self) -> None:
        self.os_manager = OSManager()
        # WebBrowserManager handles its own singleton-like instance
        self._actions = {
            "ping": self._ping,
            "web_goto": self._web_goto,
            "web_get_dom": self._web_get_dom,
            "web_click": self._web_click,
            "web_type": self._web_type,
            "get_screenshot": self.os_manager.get_screenshot,
            "create_file": self.os_manager.create_file,
        }

    async def execute(self, name: str, args: dict[str, Any]) -> EventEnvelope:
        fn = self._actions.get(name)
        if fn is None:
            return EventEnvelope(
                type="error",
                payload={"message": f"Unknown action: {name}"},
            )
        
        result = await fn(args)
        return EventEnvelope(
            type="action.result",
            payload={"name": name, "args": args, **result},
        )

    async def _ping(self, args: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    async def _web_goto(self, args: dict[str, Any]) -> dict[str, Any]:
        web = await WebBrowserManager.get_instance()
        return await web.web_goto(args)

    async def _web_get_dom(self, args: dict[str, Any]) -> dict[str, Any]:
        web = await WebBrowserManager.get_instance()
        return await web.web_get_dom(args)

    async def _web_click(self, args: dict[str, Any]) -> dict[str, Any]:
        web = await WebBrowserManager.get_instance()
        return await web.web_click(args)

    async def _web_type(self, args: dict[str, Any]) -> dict[str, Any]:
        web = await WebBrowserManager.get_instance()
        return await web.web_type(args)
