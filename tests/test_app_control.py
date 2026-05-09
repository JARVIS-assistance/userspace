from __future__ import annotations

import unittest
from unittest.mock import patch

from app.actions.handlers.base import HandlerError
from app.actions.handlers.app_control import _normalize_command_and_app
from app.actions.handlers.app_control import make_app_control
from app.actions.models import ClientAction


class AppControlTests(unittest.TestCase):
    def test_open_uses_exact_model_app_target(self) -> None:
        command, app = _normalize_command_and_app(
            ClientAction(
                type="app_control",
                command="open",
                target="Google Chrome",
                payload=None,
                args={},
                description="Chrome 실행",
                requires_confirm=False,
            )
        )
        self.assertEqual(command, "open")
        self.assertEqual(app, "Google Chrome")

    def test_app_target_separator_alias_maps_to_installed_app_name(self) -> None:
        with patch(
            "app.actions.handlers.app_control._installed_application_names",
            return_value=["Sample App"],
        ):
            command, app = _normalize_command_and_app(
                ClientAction(
                    type="app_control",
                    command="open",
                    target="sample_app",
                    payload=None,
                    args={},
                    description="앱 실행",
                    requires_confirm=False,
                )
            )
        self.assertEqual(command, "open")
        self.assertEqual(app, "Sample App")

    def test_legacy_default_browser_command_is_not_reinterpreted(self) -> None:
        command, app = _normalize_command_and_app(
            ClientAction(
                type="app_control",
                command="default_browser",
                target=None,
                payload=None,
                args={},
                description="기본 브라우저 실행",
                requires_confirm=False,
            )
        )
        self.assertEqual(command, "default_browser")
        self.assertEqual(app, "")

    def test_legacy_default_browser_command_fails_as_unsupported(self) -> None:
        async def run() -> None:
            handler = make_app_control(True)
            with self.assertRaisesRegex(HandlerError, "unsupported app_control command"):
                await handler(
                    ClientAction(
                        type="app_control",
                        command="default_browser",
                        target=None,
                        payload=None,
                        args={},
                        description="기본 브라우저 실행",
                        requires_confirm=False,
                    )
                )

        import asyncio

        asyncio.run(run())

    def test_abstract_browser_target_fails_as_contract_error(self) -> None:
        async def run() -> None:
            handler = make_app_control(True)
            with self.assertRaisesRegex(HandlerError, "invalid app_control target"):
                await handler(
                    ClientAction(
                        type="app_control",
                        command="open",
                        target="browser",
                        payload=None,
                        args={},
                        description="브라우저 실행",
                        requires_confirm=False,
                    )
                )

        import asyncio

        asyncio.run(run())

    def test_new_file_command_is_supported(self) -> None:
        command, app = _normalize_command_and_app(
            ClientAction(
                type="app_control",
                command="new_file",
                target="Sublime Text",
                payload=None,
                args={},
                description="Sublime 새 파일",
                requires_confirm=False,
            )
        )
        self.assertEqual(command, "new_file")
        self.assertEqual(app, "Sublime Text")


if __name__ == "__main__":
    unittest.main()
