from __future__ import annotations

import asyncio
import unittest

from app.realtime.sse_parser import parse_conversation_stream


class _FakeResponse:
    def __init__(self, lines: list[bytes]) -> None:
        self.content = _AsyncLines(lines)


class _AsyncLines:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = lines

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for line in self._lines:
            yield line


class SSEParserTests(unittest.TestCase):
    def test_preserves_leading_space_inside_delta_content(self) -> None:
        async def run():
            response = _FakeResponse(
                [
                    b"event: assistant_delta\n",
                    b'data: {"content":" hello"}\n',
                    b"\n",
                    b"event: assistant_done\n",
                    b'data: {"content":" hello"}\n',
                    b"\n",
                ]
            )
            events = [
                event
                async for event in parse_conversation_stream(
                    response, is_cancelled=lambda: False
                )
            ]
            return events

        events = asyncio.run(run())

        self.assertEqual(events[0].type, "conversation.delta")
        self.assertEqual(events[0].payload["text"], " hello")


if __name__ == "__main__":
    unittest.main()
