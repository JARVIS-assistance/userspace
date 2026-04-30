from __future__ import annotations

import unittest

from app.client_context import build_runtime_headers
from app.config import ActionSettings, ToggleSettings


class ClientContextTests(unittest.TestCase):
    def test_runtime_headers_include_capabilities(self) -> None:
        headers = build_runtime_headers(
            ActionSettings(
                enabled_types=("open_url", "browser_control"),
                browser_control=ToggleSettings(enabled=True),
            )
        )
        self.assertIn("X-Client-Platform", headers)
        self.assertIn("X-Client-Shell", headers)
        self.assertEqual(headers["X-Client-Browser"], "chrome")
        self.assertIn("open_url", headers["X-Client-Capabilities"])
        self.assertIn(
            "browser_control/extract_dom",
            headers["X-Client-Capabilities"],
        )
        self.assertIn(
            "browser_control/click_element",
            headers["X-Client-Capabilities"],
        )


if __name__ == "__main__":
    unittest.main()
