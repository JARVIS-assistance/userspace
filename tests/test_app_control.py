from __future__ import annotations

import unittest

from app.actions.handlers.base import HandlerError
from app.actions.handlers.app_control import _normalize_command_and_app
from app.actions.handlers.app_control import make_app_control
from app.actions.models import ClientAction


class AppControlTests(unittest.TestCase):
    def test_open_chrome_alias(self) -> None:
        command, app = _normalize_command_and_app(
            ClientAction(
                type="app_control",
                command="open",
                target="chrome",
                payload=None,
                args={},
                description="Chrome 실행",
                requires_confirm=False,
            )
        )
        self.assertEqual(command, "open")
        self.assertEqual(app, "Google Chrome")

    def test_sublime_alias(self) -> None:
        command, app = _normalize_command_and_app(
            ClientAction(
                type="app_control",
                command="open",
                target="sublime-text",
                payload=None,
                args={},
                description="Sublime 실행",
                requires_confirm=False,
            )
        )
        self.assertEqual(command, "open")
        self.assertEqual(app, "Sublime Text")

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


if __name__ == "__main__":
    unittest.main()
