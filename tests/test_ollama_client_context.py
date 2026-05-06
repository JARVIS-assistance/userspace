from __future__ import annotations

import unittest

from app.realtime.ollama_client import _client_context_payload


class OllamaClientContextTests(unittest.TestCase):
    def test_client_context_payload_mirrors_action_headers(self) -> None:
        payload = _client_context_payload(
            {
                "X-Client-Platform": "macos",
                "X-Client-Shell": "zsh",
                "X-Client-Browser": "chrome",
                "X-Client-Search-Engine": "naver",
                "X-Client-Timezone": "Asia/Seoul",
                "X-Client-Calendar-Provider": "none",
                "X-Client-Capabilities": "open_url,browser_control,browser_control/extract_dom",
                "X-Client-Enabled-Capabilities": "browser.open,browser.search",
                "X-Client-Applications": "Google Chrome,Safari",
                "X-Client-Terminal-Enabled": "false",
                "X-Client-Action-Contract-Version": "1.0",
                "X-Client-Action-Contract": "dispatch open_url",
            }
        )

        self.assertEqual(payload["browser"], "chrome")
        self.assertEqual(payload["search_engine"], "naver")
        self.assertIn("open_url", payload["capabilities"])
        self.assertIn("browser.search", payload["enabled_capabilities"])
        self.assertEqual(
            payload["action_contract"]["enabled_types"],
            ["open_url", "browser_control"],
        )
        self.assertEqual(payload["action_contract"]["instruction"], "dispatch open_url")
        self.assertFalse(payload["terminal"]["enabled"])


if __name__ == "__main__":
    unittest.main()
