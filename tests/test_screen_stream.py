from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.actions.handlers.base import HandlerError
from app.actions.handlers.screen_stream import make_screen_stream
from app.actions.models import ClientAction


def _action(action_type: str, command: str | None, args: dict | None = None) -> ClientAction:
    return ClientAction(
        type=action_type,
        command=command,
        args=args or {},
        description="screen stream",
        requires_confirm=False,
    )


class ScreenStreamHandlerTests(unittest.TestCase):
    def test_disabled_by_policy(self) -> None:
        async def run() -> None:
            handler = make_screen_stream(False, api_base="http://backend", auth_token="tok")
            with self.assertRaisesRegex(HandlerError, "disabled by policy"):
                await handler(_action("screen_stream", "start"))

        asyncio.run(run())

    def test_missing_api_base_is_rejected(self) -> None:
        async def run() -> None:
            handler = make_screen_stream(True, api_base="", auth_token="tok")
            with self.assertRaisesRegex(HandlerError, "api_base is not configured"):
                await handler(_action("screen_stream", "start"))

        asyncio.run(run())

    def test_start_and_stop_via_explicit_command(self) -> None:
        async def run() -> None:
            handler = make_screen_stream(True, api_base="http://backend", auth_token="tok")
            with patch(
                "app.actions.handlers.screen_stream.ScreenStreamer._loop",
                new=AsyncMock(side_effect=asyncio.CancelledError),
            ):
                started = await handler(_action("screen_stream", "start", {"fps": 3, "quality": 70}))
                self.assertEqual(started["fps"], 3)
                self.assertEqual(started["quality"], 70)

                stopped = await handler(_action("screen_stream", "stop"))
                self.assertEqual(stopped["command"], "stop")

        asyncio.run(run())

    def test_start_stop_inferred_from_v2_type_when_command_missing(self) -> None:
        async def run() -> None:
            handler = make_screen_stream(True, api_base="http://backend", auth_token="tok")
            with patch(
                "app.actions.handlers.screen_stream.ScreenStreamer._loop",
                new=AsyncMock(side_effect=asyncio.CancelledError),
            ):
                started = await handler(_action("screen.stream_start", None))
                self.assertEqual(started["command"], "start")

                stopped = await handler(_action("screen.stream_stop", None))
                self.assertEqual(stopped["command"], "stop")

        asyncio.run(run())

    def test_starting_twice_is_a_noop(self) -> None:
        async def run() -> None:
            handler = make_screen_stream(True, api_base="http://backend", auth_token="tok")
            with patch(
                "app.actions.handlers.screen_stream.ScreenStreamer._loop",
                new=AsyncMock(side_effect=asyncio.CancelledError),
            ):
                await handler(_action("screen_stream", "start"))
                second = await handler(_action("screen_stream", "start"))
            self.assertTrue(second.get("already_running"))
            await handler(_action("screen_stream", "stop"))

        asyncio.run(run())

    def test_fps_and_quality_are_clamped(self) -> None:
        async def run() -> None:
            handler = make_screen_stream(True, api_base="http://backend", auth_token="tok")
            with patch(
                "app.actions.handlers.screen_stream.ScreenStreamer._loop",
                new=AsyncMock(side_effect=asyncio.CancelledError),
            ):
                result = await handler(
                    _action("screen_stream", "start", {"fps": 999, "quality": 1, "max_width": 50})
                )
            self.assertEqual(result["fps"], 10.0)
            self.assertEqual(result["quality"], 10)
            self.assertEqual(result["max_width"], 320)
            await handler(_action("screen_stream", "stop"))

        asyncio.run(run())


class ScreenStreamerFrameTests(unittest.TestCase):
    def test_push_posts_frame_to_backend(self) -> None:
        from app.actions.handlers.screen_stream import ScreenStreamer

        sent: dict = {}

        async def run() -> None:
            streamer = ScreenStreamer(api_base="http://backend", auth_token="tok")

            class _FakeResponse:
                async def __aenter__(self):
                    return self

                async def __aexit__(self, *exc):
                    return False

                async def read(self):
                    return b""

            class _FakeSession:
                def post(self, url, *, json, headers):
                    sent["url"] = url
                    sent["json"] = json
                    sent["headers"] = headers
                    return _FakeResponse()

            await streamer._push(_FakeSession(), "ZmFrZQ==", 640, 480)

        asyncio.run(run())
        self.assertEqual(sent["url"], "http://backend/client/vision/frame")
        self.assertEqual(sent["json"]["frame_base64"], "ZmFrZQ==")
        self.assertEqual(sent["json"]["width"], 640)
        self.assertEqual(sent["headers"]["Authorization"], "Bearer tok")


if __name__ == "__main__":
    unittest.main()
