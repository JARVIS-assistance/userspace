from __future__ import annotations

import unittest

from app.actions.dispatcher import ActionDispatcher
from app.actions.models import PendingClientAction


class ActionModelTests(unittest.TestCase):
    def test_unknown_action_type_is_parseable_for_failed_result_submission(self) -> None:
        pending = PendingClientAction.model_validate(
            {
                "contract_version": "1.0",
                "action_id": "act_unknown",
                "request_id": "req_unknown",
                "action": {
                    "type": "new_future_type",
                    "command": "do_it",
                    "target": None,
                    "payload": None,
                    "args": {},
                    "description": "Unsupported future action",
                    "requires_confirm": False,
                    "step_id": None,
                },
            }
        )

        self.assertEqual(pending.action.type, "new_future_type")

    def test_unknown_action_type_dispatches_failed_result(self) -> None:
        async def run() -> None:
            pending = PendingClientAction.model_validate(
                {
                    "contract_version": "1.0",
                    "action_id": "act_unknown",
                    "request_id": "req_unknown",
                    "action": {
                        "type": "new_future_type",
                        "command": "do_it",
                        "target": None,
                        "payload": None,
                        "args": {},
                        "description": "Unsupported future action",
                        "requires_confirm": False,
                    },
                }
            )
            dispatcher = ActionDispatcher(emit=lambda envelope: _noop())
            status, output, error = await dispatcher.dispatch(pending)
            self.assertEqual(status, "failed")
            self.assertEqual(output, {})
            self.assertIn("no handler registered", error or "")

        import asyncio

        async def _noop() -> None:
            return None

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
