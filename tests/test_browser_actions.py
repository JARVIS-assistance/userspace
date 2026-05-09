from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.actions.dispatcher import ActionDispatcher
from app.actions.handlers.browser import build_search_url, make_browser
from app.actions.handlers.terminal import make_terminal
from app.actions.handlers.open_url import make_open_url
from app.actions.models import ClientAction, PendingClientAction


class BrowserActionTests(unittest.TestCase):
    def test_browser_search_builds_url_from_structured_query(self) -> None:
        self.assertEqual(
            build_search_url(query="연어장 레시피", engine="naver"),
            "https://search.naver.com/search.naver?query=%EC%97%B0%EC%96%B4%EC%9E%A5+%EB%A0%88%EC%8B%9C%ED%94%BC",
        )

    def test_browser_open_uses_selected_browser(self) -> None:
        async def run() -> None:
            handler = make_browser(
                enabled_capabilities={"browser.open"},
                default_browser="safari",
                search_engine="google",
            )
            with patch("app.actions.handlers.browser.open_browser") as mock_open:
                mock_open.return_value = "Safari"
                result = await handler(
                    ClientAction(
                        type="browser",
                        command="open",
                        args={},
                        description="Open browser",
                        requires_confirm=False,
                    )
                )
            self.assertEqual(result["browser"], "Safari")
            mock_open.assert_awaited_once_with("safari")

        import asyncio

        asyncio.run(run())

    def test_disabled_browser_search_fails_by_policy(self) -> None:
        async def run() -> None:
            handler = make_browser(
                enabled_capabilities={"browser.open"},
                default_browser="chrome",
                search_engine="google",
            )
            with self.assertRaisesRegex(Exception, "disabled by policy"):
                await handler(
                    ClientAction(
                        type="browser",
                        command="search",
                        args={"query": "test"},
                        description="Search",
                        requires_confirm=False,
                    )
                )

        import asyncio

        asyncio.run(run())

    def test_v2_browser_search_type_is_supported(self) -> None:
        async def run() -> None:
            handler = make_browser(
                enabled_capabilities={"browser.search"},
                default_browser="chrome",
                search_engine="duckduckgo",
            )
            with patch("app.actions.handlers.browser.open_in_browser") as mock_open:
                mock_open.return_value = "Google Chrome"
                result = await handler(
                    ClientAction(
                        type="browser.search",
                        args={"query": "salmon"},
                        description="Search",
                        requires_confirm=False,
                    )
                )
            self.assertEqual(result["engine"], "duckduckgo")
            self.assertIn("duckduckgo.com", result["generated_url"])

        import asyncio

        asyncio.run(run())

    def test_open_url_uses_configured_default_browser(self) -> None:
        async def run() -> None:
            handler = make_open_url(default_browser="safari")
            with patch("app.actions.handlers.open_url.open_in_browser") as mock_open:
                mock_open.return_value = "Safari"
                await handler(
                    ClientAction(
                        type="open_url",
                        target="https://example.com",
                        description="Open URL",
                        requires_confirm=False,
                    )
                )
            mock_open.assert_awaited_once_with("https://example.com", browser="safari")

        import asyncio

        asyncio.run(run())

    def test_unknown_action_type_returns_failed_result(self) -> None:
        async def run() -> None:
            dispatcher = ActionDispatcher(emit=lambda envelope: _noop())
            status, _, error = await dispatcher.dispatch(
                PendingClientAction(
                    action_id="act_unknown",
                    request_id="req",
                    action=ClientAction(
                        type="new_future_type",
                        description="Unknown",
                        requires_confirm=False,
                    ),
                )
            )
            self.assertEqual(status, "failed")
            self.assertIn("no handler registered", error or "")

        import asyncio

        async def _noop() -> None:
            return None

        asyncio.run(run())

    def test_open_url_with_query_uses_browser_search_capability_policy(self) -> None:
        async def run() -> None:
            dispatcher = ActionDispatcher(
                emit=lambda envelope: _noop(),
                enabled_types=set(),
                enabled_capabilities={"browser.search"},
            )
            dispatcher.register(
                "open_url",
                make_open_url(default_browser="chrome"),
            )
            with patch("app.actions.handlers.open_url.open_in_browser") as mock_open:
                mock_open.return_value = "Google Chrome"
                status, output, error = await dispatcher.dispatch(
                    PendingClientAction(
                        action_id="act_search",
                        request_id="req",
                        action=ClientAction(
                            type="open_url",
                            target="https://www.google.com/search?q=salmon",
                            args={"query": "salmon", "browser": "chrome"},
                            description="Search",
                            requires_confirm=False,
                        ),
                    )
                )
            self.assertEqual(status, "completed")
            self.assertIsNone(error)
            self.assertEqual(output["browser"], "Google Chrome")

        import asyncio

        async def _noop() -> None:
            return None

        asyncio.run(run())

    def test_open_url_type_does_not_bypass_disabled_browser_search_capability(self) -> None:
        async def run() -> None:
            dispatcher = ActionDispatcher(
                emit=lambda envelope: _noop(),
                enabled_types={"open_url"},
                enabled_capabilities={"browser.navigate"},
            )
            dispatcher.register("open_url", make_open_url(default_browser="chrome"))
            status, _, error = await dispatcher.dispatch(
                PendingClientAction(
                    action_id="act_search_disabled",
                    request_id="req",
                    action=ClientAction(
                        type="open_url",
                        target="https://www.google.com/search?q=salmon",
                        args={"query": "salmon", "browser": "chrome"},
                        description="Search",
                        requires_confirm=False,
                    ),
                )
            )
            self.assertEqual(status, "failed")
            self.assertIn("browser.search", error or "")

        import asyncio

        async def _noop() -> None:
            return None

        asyncio.run(run())

    def test_browser_control_select_result_uses_select_result_capability(self) -> None:
        async def run() -> None:
            dispatcher = ActionDispatcher(
                emit=lambda envelope: _noop(),
                enabled_types=set(),
                enabled_capabilities={"browser.select_result"},
            )

            async def handler(action: ClientAction) -> dict[str, object]:
                return {"command": action.command, "index": action.args.get("index")}

            dispatcher.register("browser_control", handler)
            status, output, error = await dispatcher.dispatch(
                PendingClientAction(
                    action_id="act_select_result",
                    request_id="req",
                    action=ClientAction(
                        type="browser_control",
                        command="select_result",
                        target="active_tab",
                        args={"index": 2},
                        description="Open second result",
                        requires_confirm=False,
                    ),
                )
            )
            self.assertEqual(status, "completed")
            self.assertIsNone(error)
            self.assertEqual(output["index"], 2)

        import asyncio

        async def _noop() -> None:
            return None

        asyncio.run(run())

    def test_terminal_run_uses_structured_command_not_execute_literal(self) -> None:
        async def run() -> None:
            handler = make_terminal(
                True,
                allowed_commands=("echo",),
            )
            with patch(
                "app.actions.handlers.terminal.asyncio.create_subprocess_exec",
                new_callable=AsyncMock,
            ) as mock_exec:
                proc = mock_exec.return_value
                proc.communicate = AsyncMock(return_value=(b"hello\n", b""))
                proc.returncode = 0
                result = await handler(
                    ClientAction(
                        type="terminal.run",
                        command="execute",
                        payload="echo hello",
                        args={"command": "echo hello"},
                        description="Run echo",
                        requires_confirm=True,
                    )
                )
            mock_exec.assert_called_once()
            self.assertEqual(mock_exec.call_args.args[:2], ("echo", "hello"))
            self.assertEqual(result["stdout"], "hello\n")

        import asyncio

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
