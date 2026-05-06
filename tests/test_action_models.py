from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.actions.dispatcher import ActionDispatcher
from app.actions.models import PendingClientAction


async def _noop() -> None:
    return None


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


class DirectV2ActionDispatchTests(unittest.TestCase):
    def test_app_open_v2_dispatch_preserves_model_target_without_local_alias_mapping(self) -> None:
        async def run() -> None:
            from app.actions.dispatcher import ActionDispatcher
            from app.actions.models import ClientAction, PendingClientAction
            from app.actions.setup import register_default_handlers
            from app.config import ActionSettings, ToggleSettings

            dispatcher = ActionDispatcher(
                emit=lambda envelope: _noop(),
                enabled_types={"app_control"},
                enabled_capabilities={"app.open"},
            )
            register_default_handlers(
                dispatcher,
                ActionSettings(
                    enabled_types=("app_control",),
                    enabled_capabilities=("app.open",),
                    app_control=ToggleSettings(enabled=True),
                ),
            )
            with patch("app.actions.handlers.app_control._application_exists", new_callable=AsyncMock) as exists, \
                 patch("app.actions.handlers.app_control._open_application", new_callable=AsyncMock) as open_app:
                exists.return_value = True
                status, output, error = await dispatcher.dispatch(
                    PendingClientAction(
                        action_id="act_app_open",
                        request_id="req",
                        action=ClientAction(
                            type="app.open",
                            target="sublime_text",
                            args={},
                            description="Open Sublime",
                            requires_confirm=False,
                        ),
                    )
                )

            self.assertEqual(status, "completed")
            self.assertIsNone(error)
            self.assertEqual(output["app"], "sublime_text")
            open_app.assert_awaited_once_with("sublime_text")

        import asyncio

        asyncio.run(run())

    def test_keyboard_type_v2_alias_reads_text_from_args(self) -> None:
        async def run() -> None:
            from app.actions.dispatcher import ActionDispatcher
            from app.actions.models import ClientAction, PendingClientAction
            from app.actions.setup import register_default_handlers
            from app.config import ActionSettings, PhysicalInputSettings

            dispatcher = ActionDispatcher(
                emit=lambda envelope: _noop(),
                enabled_types={"keyboard_type"},
                enabled_capabilities={"keyboard.type"},
                force_confirm_capabilities=set(),
            )
            register_default_handlers(
                dispatcher,
                ActionSettings(
                    enabled_types=("keyboard_type",),
                    enabled_capabilities=("keyboard.type",),
                    force_confirm_capabilities=(),
                    physical_input=PhysicalInputSettings(enabled=True),
                ),
            )
            with patch("app.actions.handlers.physical_input._run_script", new_callable=AsyncMock) as run_script:
                status, output, error = await dispatcher.dispatch(
                    PendingClientAction(
                        action_id="act_type",
                        request_id="req",
                        action=ClientAction(
                            type="keyboard.type",
                            args={"text": "안녕하세요"},
                            description="Type Korean",
                            requires_confirm=False,
                        ),
                    )
                )

            self.assertEqual(status, "completed")
            self.assertIsNone(error)
            self.assertEqual(output["typed_length"], 5)
            run_script.assert_awaited_once()

        import asyncio

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
