from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import load_settings


class TestConfigLoading(unittest.TestCase):
    def test_loads_ultra_low_latency_profile_from_json(self) -> None:
        payload = {
            "server": {"host": "0.0.0.0", "port": 9999, "env": "test"},
            "stt": {
                "model_name": "base",
                "default_profile": "ultra_low_latency",
                "profiles": {
                    "ultra_low_latency": {
                        "frame_ms": 8,
                        "partial_interval_ms": 160,
                    }
                },
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 9999)
        self.assertEqual(settings.stt_default_profile, "ultra_low_latency")
        self.assertEqual(settings.stt_model_name, "base")
        self.assertEqual(settings.stt_profiles["ultra_low_latency"].frame_ms, 8)
        self.assertEqual(settings.stt_profiles["ultra_low_latency"].partial_interval_ms, 160)
        self.assertEqual(settings.actions.enabled_types, ("notify", "clipboard", "open_url"))
        self.assertFalse(settings.actions.terminal.enabled)

    def test_env_overrides_api_base_urls(self) -> None:
        payload = {
            "server": {"auth_api_base": "http://config-auth.local/"},
            "ollama": {"base_url": "http://config-ollama.local/"},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            with patch.dict(
                os.environ,
                {
                    "AUTH_API_BASE": "https://auth.example.com/",
                    "OLLAMA_BASE_URL": "https://ollama.example.com/",
                    "USERSPACE_HOST": "10.10.0.8",
                    "USERSPACE_PORT": "9876",
                },
                clear=False,
            ):
                settings = load_settings(str(path))

        self.assertEqual(settings.host, "10.10.0.8")
        self.assertEqual(settings.port, 9876)
        self.assertEqual(settings.auth_api_base, "https://auth.example.com")
        self.assertEqual(settings.ollama.base_url, "https://ollama.example.com")

    def test_loads_action_policy_from_json(self) -> None:
        payload = {
            "actions": {
                "enabled_types": ["notify", "clipboard", "open_url", "terminal"],
                "file_write": {"allowed_paths": ["/tmp/jarvis"]},
                "terminal": {
                    "enabled": True,
                    "allowed_commands": ["pwd", "git status"],
                },
                "physical_input": {"enabled": False},
                "web_search": {"enabled": True},
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertIn("terminal", settings.actions.enabled_types)
        self.assertEqual(settings.actions.file_write.allowed_paths, ("/tmp/jarvis",))
        self.assertTrue(settings.actions.terminal.enabled)
        self.assertEqual(settings.actions.terminal.allowed_commands, ("pwd", "git status"))
        self.assertFalse(settings.actions.physical_input.enabled)
        self.assertTrue(settings.actions.web_search.enabled)


if __name__ == "__main__":
    unittest.main()
