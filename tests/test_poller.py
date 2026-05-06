from __future__ import annotations

import unittest

from app.actions.models import ClientAction, PendingClientAction
from app.actions.poller import ActionPoller


class FakeAPI:
    base_url = "http://test"

    def __init__(self) -> None:
        self.results: list[tuple[str, str, dict, str | None]] = []

    async def submit_result(
        self,
        action_id: str,
        status: str,
        output: dict | None = None,
        error: str | None = None,
    ) -> None:
        self.results.append((action_id, status, output or {}, error))


class FakeDispatcher:
    def __init__(self) -> None:
        self.dispatched: list[str] = []

    async def dispatch(self, pending: PendingClientAction):
        self.dispatched.append(pending.action_id)
        if pending.action_id == "act_fail":
            return "failed", {}, "application not found"
        return "completed", {"ok": True}, None


class PollerTests(unittest.TestCase):
    def test_followup_action_is_rejected_after_request_failure(self) -> None:
        async def run() -> None:
            api = FakeAPI()
            dispatcher = FakeDispatcher()
            poller = ActionPoller(api=api, dispatcher=dispatcher)  # type: ignore[arg-type]

            first = _pending("act_fail", "req_1", "app_control")
            second = _pending("act_type", "req_1", "keyboard_type")

            await poller.dispatch_pending_now(first)
            await poller.dispatch_pending_now(second)

            self.assertEqual(dispatcher.dispatched, ["act_fail"])
            self.assertEqual(api.results[0][1], "failed")
            self.assertEqual(api.results[1][1], "rejected")
            self.assertIn("previous action in request failed", api.results[1][3] or "")

        import asyncio

        asyncio.run(run())


def _pending(action_id: str, request_id: str, action_type: str) -> PendingClientAction:
    return PendingClientAction(
        contract_version="1.0",
        action_id=action_id,
        request_id=request_id,
        action=ClientAction(
            type=action_type,
            command="open" if action_type == "app_control" else None,
            target="Sublime Text" if action_type == "app_control" else None,
            payload="안녕하세요" if action_type == "keyboard_type" else None,
            args={},
            description="test action",
            requires_confirm=False,
        ),
    )


if __name__ == "__main__":
    unittest.main()
