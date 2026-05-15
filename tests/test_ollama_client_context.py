from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.realtime.ollama_client import _client_context_payload


class OllamaClientContextTests(unittest.TestCase):
    def test_client_context_payload_mirrors_action_headers(self) -> None:
        with patch.dict(os.environ, {"USERSPACE_APPLICATIONS": "Google Chrome,Safari"}):
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
                    "X-Client-Terminal-Enabled": "true",
                    "X-Client-Terminal-Shell-Path": "/bin/zsh",
                    "X-Client-Terminal-Cwd": "/tmp/work",
                    "X-Client-Terminal-Allowed-Commands": "echo,pwd,ls,git status",
                    "X-Client-Terminal-Cwd-Allowlist": "/tmp/work",
                    "X-Client-Terminal-Timeout-Seconds": "20",
                    "X-Client-Action-Contract-Version": "1.0",
                    "X-Client-Action-Contract": "dispatch open_url",
                }
            )

        self.assertEqual(payload["browser"], "chrome")
        self.assertEqual(payload["search_engine"], "naver")
        self.assertIn("open_url", payload["capabilities"])
        self.assertIn("browser.search", payload["enabled_capabilities"])
        self.assertIsInstance(payload["applications"][0], dict)
        self.assertEqual(payload["applications"][0]["name"], "Google Chrome")
        self.assertIn("aliases", payload["applications"][0])
        self.assertEqual(
            payload["action_contract"]["enabled_types"],
            ["open_url", "browser_control"],
        )
        self.assertEqual(payload["action_contract"]["instruction"], "dispatch open_url")
        self.assertTrue(payload["terminal"]["enabled"])
        self.assertEqual(payload["terminal"]["shell"], "zsh")
        self.assertEqual(payload["terminal"]["shell_path"], "/bin/zsh")
        self.assertEqual(payload["terminal"]["cwd"], "/tmp/work")
        self.assertEqual(
            payload["terminal"]["allowed_commands"],
            ["echo", "pwd", "ls", "git status"],
        )
        self.assertEqual(payload["terminal"]["allowed_cwds"], ["/tmp/work"])
        self.assertFalse(payload["terminal"]["supports_pty"])
        self.assertTrue(payload["terminal"]["requires_confirm"])
        self.assertEqual(payload["terminal"]["timeout_seconds"], 20)


if __name__ == "__main__":
    unittest.main()
