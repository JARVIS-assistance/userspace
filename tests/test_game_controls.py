from __future__ import annotations

import asyncio
import sys
import types
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.actions.handlers.base import HandlerError
from app.actions.handlers.physical_input import (
    make_hotkey,
    make_mouse_click,
    make_mouse_move,
    make_mouse_scroll,
)
from app.actions.models import ClientAction


def _action(action_type: str, args: dict, **kwargs) -> ClientAction:
    return ClientAction(
        type=action_type,
        args=args,
        description=action_type,
        requires_confirm=False,
        **kwargs,
    )


def _install_fake_pyautogui() -> types.ModuleType:
    fake = types.ModuleType("pyautogui")
    fake.click = lambda *a, **k: None
    fake.moveTo = lambda *a, **k: None
    fake.scroll = lambda *a, **k: None
    fake.hscroll = lambda *a, **k: None
    sys.modules["pyautogui"] = fake
    return fake


class MouseClickTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = _install_fake_pyautogui()
        self.fake.click = MagicMock()
        self.addCleanup(sys.modules.pop, "pyautogui", None)

    def test_left_click_is_default(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_click(True)
                result = await handler(_action("mouse_click", {"x": 10, "y": 20}))
            self.assertEqual(result["button"], "left")
            self.fake.click.assert_called_once_with(10, 20, clicks=1, button="left")

        asyncio.run(run())

    def test_right_click_is_supported(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_click(True)
                result = await handler(
                    _action("mouse_click", {"x": 10, "y": 20, "button": "right"})
                )
            self.assertEqual(result["button"], "right")
            self.fake.click.assert_called_once_with(10, 20, clicks=1, button="right")

        asyncio.run(run())

    def test_invalid_button_rejected(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_click(True)
                with self.assertRaisesRegex(HandlerError, "button must be one of"):
                    await handler(_action("mouse_click", {"x": 0, "y": 0, "button": "banana"}))

        asyncio.run(run())


class MouseMoveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = _install_fake_pyautogui()
        self.fake.moveTo = MagicMock()
        self.addCleanup(sys.modules.pop, "pyautogui", None)

    def test_moves_cursor_without_clicking(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_move(True)
                result = await handler(_action("mouse_move", {"x": 50, "y": 60}))
            self.assertEqual(result["x"], 50)
            self.fake.moveTo.assert_called_once_with(50, 60, result["duration_seconds"])

        asyncio.run(run())

    def test_disabled_by_policy(self) -> None:
        async def run() -> None:
            handler = make_mouse_move(False)
            with self.assertRaisesRegex(HandlerError, "disabled by policy"):
                await handler(_action("mouse_move", {"x": 0, "y": 0}))

        asyncio.run(run())


class MouseScrollTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = _install_fake_pyautogui()
        self.fake.scroll = MagicMock()
        self.fake.hscroll = MagicMock()
        self.addCleanup(sys.modules.pop, "pyautogui", None)

    def test_scroll_down_uses_negative_amount(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_scroll(True)
                result = await handler(
                    _action("mouse_scroll", {"direction": "down", "amount": 300})
                )
            self.assertEqual(result["amount"], 300)
            self.fake.scroll.assert_called_once_with(-300)

        asyncio.run(run())

    def test_scroll_up_uses_positive_amount_with_position(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_scroll(True)
                await handler(
                    _action(
                        "mouse_scroll",
                        {"direction": "up", "amount": 150, "x": 400, "y": 300},
                    )
                )
            self.fake.scroll.assert_called_once_with(150, x=400, y=300)

        asyncio.run(run())

    def test_horizontal_scroll_uses_hscroll(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_scroll(True)
                await handler(_action("mouse_scroll", {"direction": "left", "amount": 100}))
            self.fake.hscroll.assert_called_once_with(-100)

        asyncio.run(run())

    def test_rejects_unsupported_direction(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_scroll(True)
                with self.assertRaisesRegex(HandlerError, "unsupported scroll direction"):
                    await handler(_action("mouse_scroll", {"direction": "diagonal", "amount": 1}))

        asyncio.run(run())


class HotkeyHoldTests(unittest.TestCase):
    def test_without_duration_sends_single_keystroke(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"), patch(
                "app.actions.handlers.physical_input._run_script",
                new_callable=AsyncMock,
            ) as mock_script:
                handler = make_hotkey(True)
                result = await handler(_action("hotkey", {"keys": "w"}))
            self.assertEqual(result["keys"], ["w"])
            mock_script.assert_awaited_once()
            self.assertIn("keystroke", mock_script.await_args.args[0])

        asyncio.run(run())

    def test_with_duration_holds_key_down_then_up(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"), patch(
                "app.actions.handlers.physical_input._run_script",
                new_callable=AsyncMock,
            ) as mock_script, patch(
                "app.actions.handlers.physical_input.asyncio.sleep",
                new_callable=AsyncMock,
            ) as mock_sleep:
                handler = make_hotkey(True)
                result = await handler(
                    _action("hotkey", {"keys": "w", "duration_seconds": 1.5})
                )
            self.assertEqual(result["duration_seconds"], 1.5)
            mock_sleep.assert_awaited_once_with(1.5)
            self.assertEqual(mock_script.await_count, 2)
            self.assertIn("key down", mock_script.await_args_list[0].args[0])
            self.assertIn("key up", mock_script.await_args_list[1].args[0])

        asyncio.run(run())

    def test_duration_is_clamped_to_30_seconds(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"), patch(
                "app.actions.handlers.physical_input._run_script",
                new_callable=AsyncMock,
            ), patch(
                "app.actions.handlers.physical_input.asyncio.sleep",
                new_callable=AsyncMock,
            ) as mock_sleep:
                handler = make_hotkey(True)
                await handler(_action("hotkey", {"keys": "w", "duration_seconds": 999}))
            mock_sleep.assert_awaited_once_with(30.0)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
