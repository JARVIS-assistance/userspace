from __future__ import annotations

import os
import unittest
from unittest.mock import patch

import run


class RunVisionTests(unittest.TestCase):
    def test_vision_runtime_launches_by_default(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("run.os.path.isdir", return_value=True),
            patch.object(run, "_spawn_child", return_value="proc") as spawn_child,
        ):
            proc = run.start_vision("/tmp/project/userspace")

        self.assertEqual(proc, "proc")
        spawn_child.assert_called_once()

    def test_vision_runtime_can_be_disabled_by_env(self) -> None:
        with (
            patch.dict(os.environ, {"JARVIS_VISION_ENABLE": "0"}, clear=True),
            patch.object(run, "_spawn_child") as spawn_child,
        ):
            proc = run.start_vision("/tmp/userspace")

        self.assertIsNone(proc)
        spawn_child.assert_not_called()

    def test_vision_child_auto_features_default_on(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            env = run._build_vision_env()

        self.assertEqual(env["VITE_VISION_AUTO_START"], "1")
        self.assertEqual(env["VITE_VISION_AUTO_CONTROL"], "1")
        self.assertEqual(env["VITE_VISION_TRIGGER_ENABLE"], "1")


if __name__ == "__main__":
    unittest.main()
