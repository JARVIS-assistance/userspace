from __future__ import annotations

import os
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.client_context import (
    build_runtime_headers,
    build_runtime_profile,
    list_available_application_profiles,
    list_available_applications,
)
from app.config import ActionSettings, TerminalSettings, ToggleSettings


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
        self.assertEqual(headers["X-Client-Search-Engine"], "google")
        self.assertIn("open_url", headers["X-Client-Capabilities"])
        self.assertNotIn("app.open", headers["X-Client-Capabilities"])
        self.assertNotIn("keyboard.type", headers["X-Client-Capabilities"])
        self.assertNotIn("screen.screenshot", headers["X-Client-Capabilities"])
        self.assertIn("app.open", headers["X-Client-Supported-Capabilities"])
        self.assertIn("keyboard.type", headers["X-Client-Supported-Capabilities"])
        self.assertIn("screen.screenshot", headers["X-Client-Supported-Capabilities"])
        self.assertIn("browser.search", headers["X-Client-Enabled-Capabilities"])
        self.assertEqual(headers["X-Client-Action-Contract-Version"], "1.0")
        self.assertIn("action_dispatch", headers["X-Client-Action-Contract"])
        self.assertIn("open_url", headers["X-Client-Action-Contract"])
        self.assertIn(
            "browser_control/extract_dom",
            headers["X-Client-Capabilities"],
        )
        self.assertIn(
            "browser_control/click_element",
            headers["X-Client-Capabilities"],
        )
        self.assertIn("X-Client-Applications", headers)
        self.assertEqual(headers["X-Client-Terminal-Enabled"], "false")

    def test_runtime_headers_include_terminal_policy(self) -> None:
        headers = build_runtime_headers(
            ActionSettings(
                enabled_types=("terminal",),
                terminal=TerminalSettings(
                    enabled=True,
                    allowed_commands=("pwd", "git"),
                    cwd_allowlist=("/tmp/work",),
                ),
            )
        )
        self.assertIn("terminal/execute", headers["X-Client-Capabilities"])
        self.assertEqual(headers["X-Client-Terminal-Enabled"], "true")
        self.assertTrue(headers["X-Client-Terminal-Shell-Path"])
        self.assertEqual(headers["X-Client-Terminal-Cwd"], "/tmp/work")
        self.assertEqual(headers["X-Client-Terminal-Allowed-Commands"], "pwd,git")
        self.assertEqual(headers["X-Client-Terminal-Cwd-Allowlist"], "/tmp/work")
        self.assertEqual(headers["X-Client-Terminal-Timeout-Seconds"], "20")

    def test_list_available_applications_from_override(self) -> None:
        with patch.dict(
            os.environ,
            {"USERSPACE_APPLICATIONS": "Sublime Text,Google Chrome,Sublime Text"},
        ):
            self.assertEqual(
                list_available_applications(),
                ["Google Chrome", "Sublime Text"],
            )
            profiles = list_available_application_profiles()
            chrome = next(item for item in profiles if item["name"] == "Google Chrome")
            self.assertIn("Chrome", chrome["aliases"])
            sublime = next(item for item in profiles if item["name"] == "Sublime Text")
            self.assertIn("sublimetext", sublime["aliases"])

    def test_list_available_applications_from_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Sublime Text.app").mkdir()
            (root / "Google Chrome.app").mkdir()
            (root / "Not An App.txt").write_text("", encoding="utf-8")

            with patch.dict(
                os.environ,
                {
                    "USERSPACE_APPLICATIONS": "",
                    "USERSPACE_APPLICATION_DIRS": tmp,
                },
            ):
                self.assertEqual(
                    list_available_applications(),
                    ["Google Chrome", "Sublime Text"],
                )

    def test_weather_profile_includes_plist_and_capability_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contents = root / "Weather.app" / "Contents"
            contents.mkdir(parents=True)
            with (contents / "Info.plist").open("wb") as fh:
                plistlib.dump(
                    {
                        "CFBundleIdentifier": "com.apple.weather",
                        "CFBundleExecutable": "Weather",
                        "CFBundleDisplayName": "Weather",
                    },
                    fh,
                )

            with patch.dict(
                os.environ,
                {
                    "USERSPACE_APPLICATIONS": "",
                    "USERSPACE_APPLICATION_DIRS": tmp,
                },
            ):
                profiles = list_available_application_profiles()

        weather = profiles[0]
        self.assertEqual(weather["name"], "Weather")
        self.assertEqual(weather["display_name"], "Weather")
        self.assertEqual(weather["bundle_id"], "com.apple.weather")
        self.assertEqual(weather["executable"], "Weather")
        self.assertIn("weather", weather["categories"])
        self.assertIn("weather", weather["capabilities"])
        self.assertIn("forecast", weather["capabilities"])
        self.assertIn("날씨", weather["capabilities"])
        self.assertIn("예보", weather["capabilities"])
        self.assertIn("오늘 날씨", weather["keywords"])
        self.assertIn("날씨", weather["aliases"])

    def test_build_runtime_profile_includes_applications(self) -> None:
        with patch.dict(os.environ, {"USERSPACE_APPLICATIONS": "Google Chrome"}):
            profile = build_runtime_profile(ActionSettings())

        self.assertIn(profile["platform"], {"macos", "windows", "linux"})
        self.assertEqual(profile["applications"][0]["name"], "Google Chrome")
        self.assertIn("Chrome", profile["applications"][0]["aliases"])
        self.assertIn("browser.search", profile["enabled_capabilities"])
        self.assertIn("terminal.run", profile["supported_capabilities"])
        self.assertNotIn("terminal.run", profile["capabilities"])

    def test_build_runtime_profile_includes_terminal_policy(self) -> None:
        profile = build_runtime_profile(
            ActionSettings(
                enabled_types=("terminal",),
                enabled_capabilities=("terminal.run",),
                terminal=TerminalSettings(
                    enabled=True,
                    allowed_commands=("echo", "pwd", "ls", "git status"),
                    cwd_allowlist=("/tmp/work",),
                ),
            )
        )

        self.assertIn("terminal.run", profile["capabilities"])
        self.assertEqual(profile["terminal"]["enabled"], True)
        self.assertTrue(profile["terminal"]["shell"])
        self.assertTrue(profile["terminal"]["shell_path"])
        self.assertEqual(profile["terminal"]["cwd"], "/tmp/work")
        self.assertEqual(
            profile["terminal"]["allowed_commands"],
            ["echo", "pwd", "ls", "git status"],
        )
        self.assertEqual(profile["terminal"]["allowed_cwds"], ["/tmp/work"])
        self.assertEqual(profile["terminal"]["supports_pty"], False)
        self.assertEqual(profile["terminal"]["requires_confirm"], True)
        self.assertEqual(profile["terminal"]["timeout_seconds"], 20)


if __name__ == "__main__":
    unittest.main()
