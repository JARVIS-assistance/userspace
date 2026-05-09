from __future__ import annotations

import unittest

from app.actions.handlers.base import HandlerError
from app.actions.handlers.calendar_control import make_calendar_control
from app.actions.models import ClientAction


class CalendarControlTests(unittest.TestCase):
    def test_disabled_policy_rejects_calendar_action(self) -> None:
        async def run() -> None:
            handler = make_calendar_control(False)
            with self.assertRaisesRegex(HandlerError, "disabled by policy"):
                await handler(_action("open"))

        import asyncio

        asyncio.run(run())

    def test_provider_mutation_requires_integration(self) -> None:
        async def run() -> None:
            handler = make_calendar_control(True)
            with self.assertRaisesRegex(HandlerError, "provider integration"):
                await handler(_action("create_event"))

        import asyncio

        asyncio.run(run())


def _action(command: str) -> ClientAction:
    return ClientAction(
        type="calendar_control",
        command=command,
        target=None,
        payload=None,
        args={"provider": "local"},
        description="calendar test",
        requires_confirm=command != "open",
    )


if __name__ == "__main__":
    unittest.main()
