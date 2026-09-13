from __future__ import annotations

import unittest

import run


class RunVisionTests(unittest.TestCase):
    def test_vision_is_managed_by_electron(self) -> None:
        self.assertFalse(hasattr(run, "start_vision"))
        self.assertFalse(hasattr(run, "_build_vision_env"))


if __name__ == "__main__":
    unittest.main()
