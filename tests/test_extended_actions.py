from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.actions.handlers.file_ops import make_file_list, make_file_manage, make_file_search
from app.actions.handlers.base import HandlerError
from app.actions.handlers.system_info import system_info
from app.actions.models import ClientAction


def action(action_type: str, target: str = "", **args) -> ClientAction:
    return ClientAction(
        type=action_type,
        target=target or None,
        args=args,
        description=action_type,
        requires_confirm=False,
    )


class ExtendedActionTests(unittest.TestCase):
    def test_file_lifecycle_inside_allowed_root(self) -> None:
        async def run() -> None:
            with TemporaryDirectory() as root:
                manage = make_file_manage((root,))
                listing = make_file_list((root,))
                source = Path(root) / "source"
                destination = Path(root) / "renamed"

                await manage(action("file.mkdir", str(source)))
                result = await listing(action("file.list", root))
                self.assertEqual(result["entries"][0]["name"], "source")

                await manage(action("file.move", str(source), destination=str(destination)))
                self.assertTrue(destination.is_dir())
                await manage(action("file.delete", str(destination)))
                self.assertFalse(destination.exists())

        asyncio.run(run())

    def test_system_info_is_read_only_and_structured(self) -> None:
        result = asyncio.run(system_info(action("system.info")))
        self.assertTrue(result["platform"])
        self.assertIn("free", result["disk"])

    def test_allowed_root_cannot_be_deleted(self) -> None:
        async def run() -> None:
            with TemporaryDirectory() as root:
                manage = make_file_manage((root,))
                with self.assertRaises(HandlerError):
                    await manage(action("file.delete", root, recursive=True))

        asyncio.run(run())

    def test_file_search_is_bounded_to_allowed_root(self) -> None:
        async def run() -> None:
            with TemporaryDirectory() as root:
                Path(root, "meeting-notes.md").write_text("notes", encoding="utf-8")
                Path(root, "other.txt").write_text("other", encoding="utf-8")
                search = make_file_search((root,))
                result = await search(action("file.search", root, query="meeting"))
                self.assertEqual(result["count"], 1)
                self.assertEqual(result["matches"][0]["name"], "meeting-notes.md")

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
