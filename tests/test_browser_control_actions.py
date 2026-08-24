from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.actions.handlers.base import HandlerError
from app.actions.handlers.browser_control import make_browser_control
from app.actions.models import ClientAction


def _action(command: str, args: dict | None = None, **kwargs) -> ClientAction:
    return ClientAction(
        type="browser_control",
        command=command,
        args=args or {},
        description=f"browser_control {command}",
        requires_confirm=False,
        **kwargs,
    )


class BrowserControlNewCommandsTests(unittest.TestCase):
    def test_scroll_injects_scrollby_javascript(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control._execute_browser_javascript",
                new_callable=AsyncMock,
            ) as mock_js:
                mock_js.return_value = {}
                result = await handler(_action("scroll", {"direction": "down", "amount": 400}))
            self.assertEqual(result["command"], "scroll")
            self.assertEqual(result["direction"], "down")
            self.assertEqual(result["amount"], 400)
            mock_js.assert_awaited()
            script = mock_js.await_args.args[1]
            self.assertIn("window.scrollBy(0, 400)", script)

        asyncio.run(run())

    def test_scroll_rejects_unsupported_direction(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with self.assertRaisesRegex(HandlerError, "unsupported scroll direction"):
                await handler(_action("scroll", {"direction": "diagonal"}))

        asyncio.run(run())

    def test_search_new_tab_opens_generated_search_url(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control.open_in_browser",
                new_callable=AsyncMock,
            ) as mock_open:
                mock_open.return_value = "Google Chrome"
                result = await handler(
                    _action("search", {"query": "salmon recipe", "new_tab": True})
                )
            self.assertEqual(result["browser"], "Google Chrome")
            self.assertIn("google.com/search", result["generated_url"])
            mock_open.assert_awaited_once()

        asyncio.run(run())

    def test_search_current_tab_navigates_via_javascript(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control._execute_browser_javascript",
                new_callable=AsyncMock,
            ) as mock_js:
                mock_js.return_value = {}
                result = await handler(_action("search", {"query": "salmon recipe"}))
            self.assertIn("google.com/search", result["opened"])
            mock_js.assert_awaited()

        asyncio.run(run())

    def test_search_requires_query(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with self.assertRaisesRegex(HandlerError, "requires args.query"):
                await handler(_action("search", {}))

        asyncio.run(run())

    def test_new_tab_with_url_reuses_open_in_browser(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control.open_in_browser",
                new_callable=AsyncMock,
            ) as mock_open:
                mock_open.return_value = "Google Chrome"
                result = await handler(_action("new_tab", {"url": "https://example.com"}))
            self.assertEqual(result["opened"], "https://example.com")
            mock_open.assert_awaited_once_with("https://example.com", browser="chrome")

        asyncio.run(run())

    def test_new_tab_without_url_sends_keystroke(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control._run_system_events_script",
                new_callable=AsyncMock,
            ) as mock_script:
                result = await handler(_action("new_tab", {}))
            self.assertEqual(result["command"], "new_tab")
            mock_script.assert_awaited_once()
            self.assertIn('keystroke "t"', mock_script.await_args.args[0])

        asyncio.run(run())

    def test_new_window_creates_window_and_navigates(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control._run_system_events_script",
                new_callable=AsyncMock,
            ) as mock_script, patch(
                "app.actions.handlers.browser_control._execute_browser_javascript",
                new_callable=AsyncMock,
            ) as mock_js:
                mock_js.return_value = {}
                result = await handler(_action("new_window", {"url": "https://example.com"}))
            self.assertEqual(result["browser"], "Google Chrome")
            self.assertEqual(result["opened"], "https://example.com")
            mock_script.assert_awaited_once()
            self.assertIn("make new window", mock_script.await_args.args[0])
            mock_js.assert_awaited_once()

        asyncio.run(run())

    def test_close_tab_sends_command_w(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control._run_system_events_script",
                new_callable=AsyncMock,
            ) as mock_script:
                result = await handler(_action("close_tab"))
            self.assertEqual(result["command"], "close_tab")
            self.assertIn('keystroke "w"', mock_script.await_args.args[0])

        asyncio.run(run())

    def test_focus_address_bar_sends_command_l(self) -> None:
        async def run() -> None:
            handler = make_browser_control(True, default_browser="chrome")
            with patch(
                "app.actions.handlers.browser_control._run_system_events_script",
                new_callable=AsyncMock,
            ) as mock_script:
                result = await handler(_action("focus_address_bar"))
            self.assertEqual(result["command"], "focus_address_bar")
            self.assertIn('keystroke "l"', mock_script.await_args.args[0])

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
