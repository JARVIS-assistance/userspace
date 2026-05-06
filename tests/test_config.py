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
        self.assertEqual(
            settings.actions.enabled_types,
            ("notify", "clipboard", "open_url", "browser"),
        )
        self.assertIn("browser.search", settings.actions.enabled_capabilities)
        self.assertFalse(settings.actions.terminal.enabled)
        self.assertNotIn("keyboard_type", settings.actions.force_confirm_types)
        self.assertNotIn("hotkey", settings.actions.force_confirm_types)

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
                "enabled_capabilities": ["browser.search", "terminal.run"],
                "browser": {
                    "default_browser": "safari",
                    "search_engine": "naver",
                },
                "file_write": {"allowed_paths": ["/tmp/jarvis"]},
                "terminal": {
                    "enabled": True,
                    "allowed_commands": ["pwd", "git status"],
                },
                "physical_input": {"enabled": False},
                "web_search": {"enabled": True},
                "calendar_control": {"enabled": True},
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertIn("terminal", settings.actions.enabled_types)
        self.assertIn("browser.search", settings.actions.enabled_capabilities)
        self.assertEqual(settings.actions.browser.default_browser, "safari")
        self.assertEqual(settings.actions.browser.search_engine, "naver")
        self.assertEqual(settings.actions.file_write.allowed_paths, ("/tmp/jarvis",))
        self.assertTrue(settings.actions.terminal.enabled)
        self.assertEqual(settings.actions.terminal.allowed_commands, ("pwd", "git status"))
        self.assertFalse(settings.actions.physical_input.enabled)
        self.assertTrue(settings.actions.web_search.enabled)
        self.assertTrue(settings.actions.calendar_control.enabled)

    def test_capability_defaults_include_browser_foundation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps({}), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertIn("browser", settings.actions.enabled_types)
        self.assertIn("browser.open", settings.actions.enabled_capabilities)
        self.assertIn("browser.navigate", settings.actions.enabled_capabilities)
        self.assertIn("browser.search", settings.actions.enabled_capabilities)
        self.assertIn("terminal.run", settings.actions.force_confirm_capabilities)

    def test_omitted_enabled_capabilities_are_derived_from_enabled_types(self) -> None:
        payload = {
            "actions": {
                "enabled_types": [
                    "open_url",
                    "app_control",
                    "keyboard_type",
                    "terminal",
                    "screenshot",
                    "browser_control",
                ],
                "app_control": {"enabled": True},
                "physical_input": {"enabled": True},
                "terminal": {"enabled": True, "allowed_commands": ["pwd"]},
                "screenshot": {"enabled": True},
                "browser_control": {"enabled": True},
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertIn("app.open", settings.actions.enabled_capabilities)
        self.assertIn("keyboard.type", settings.actions.enabled_capabilities)
        self.assertIn("terminal.run", settings.actions.enabled_capabilities)
        self.assertIn("screen.screenshot", settings.actions.enabled_capabilities)
        self.assertIn("browser.extract_dom", settings.actions.enabled_capabilities)

    def test_explicit_enabled_capabilities_remain_restrictive(self) -> None:
        payload = {
            "actions": {
                "enabled_types": ["app_control", "keyboard_type"],
                "enabled_capabilities": ["app.open"],
                "app_control": {"enabled": True},
                "physical_input": {"enabled": True},
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertEqual(settings.actions.enabled_capabilities, ("app.open",))
        self.assertNotIn("keyboard.type", settings.actions.enabled_capabilities)


if __name__ == "__main__":
    unittest.main()
