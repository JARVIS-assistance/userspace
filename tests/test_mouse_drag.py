from __future__ import annotations

import asyncio
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

from app.actions.handlers.base import HandlerError
from app.actions.handlers.physical_input import make_mouse_drag
from app.actions.models import ClientAction


def _drag_action(args: dict) -> ClientAction:
    return ClientAction(
        type="mouse_drag",
        args=args,
        description="drag",
        requires_confirm=True,
    )


class MouseDragTests(unittest.TestCase):
    def _install_fake_pyautogui(self) -> types.ModuleType:
        fake = types.ModuleType("pyautogui")
        fake.moveTo = lambda *a, **k: None
        fake.dragTo = lambda *a, **k: None
        sys.modules["pyautogui"] = fake
        self.addCleanup(sys.modules.pop, "pyautogui", None)
        return fake

    def test_disabled_by_policy(self) -> None:
        async def run() -> None:
            handler = make_mouse_drag(False)
            with self.assertRaisesRegex(HandlerError, "disabled by policy"):
                await handler(_drag_action({"start_x": 0, "start_y": 0, "end_x": 10, "end_y": 10}))

        asyncio.run(run())

    def test_requires_integer_coordinates(self) -> None:
        async def run() -> None:
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_drag(True)
                with self.assertRaisesRegex(HandlerError, "requires integer args"):
                    await handler(_drag_action({"start_x": "x", "start_y": 0, "end_x": 10, "end_y": 10}))

        asyncio.run(run())

    def test_drags_from_start_to_end_using_pyautogui(self) -> None:
        async def run() -> None:
            fake = self._install_fake_pyautogui()
            fake.moveTo = MagicMock()
            fake.dragTo = MagicMock()
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_drag(True)
                result = await handler(
                    _drag_action(
                        {"start_x": 10, "start_y": 20, "end_x": 100, "end_y": 200}
                    )
                )
            self.assertEqual(result["start_x"], 10)
            self.assertEqual(result["end_y"], 200)
            fake.moveTo.assert_called_once_with(10, 20)
            fake.dragTo.assert_called_once_with(100, 200, result["duration_seconds"], button="left")

        asyncio.run(run())

    def test_duration_is_clamped(self) -> None:
        async def run() -> None:
            fake = self._install_fake_pyautogui()
            with patch("app.actions.handlers.physical_input.sys.platform", "darwin"):
                handler = make_mouse_drag(True)
                result = await handler(
                    _drag_action(
                        {
                            "start_x": 0,
                            "start_y": 0,
                            "end_x": 1,
                            "end_y": 1,
                            "duration_seconds": 99,
                        }
                    )
                )
            self.assertEqual(result["duration_seconds"], 5.0)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
