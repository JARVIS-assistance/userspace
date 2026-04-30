"""Runtime context headers sent to the Controller."""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

from app.config import ActionSettings


def build_runtime_headers(actions: ActionSettings) -> dict[str, str]:
    return {
        "X-Client-Platform": _platform_name(),
        "X-Client-Shell": _shell_name(),
        "X-Client-Browser": os.getenv("USERSPACE_BROWSER", "chrome"),
        "X-Client-Timezone": os.getenv("TZ", "Asia/Seoul"),
        "X-Client-Calendar-Provider": os.getenv(
            "USERSPACE_CALENDAR_PROVIDER",
            "none",
        ),
        "X-Client-Capabilities": ",".join(_capabilities(actions)),
    }


def _platform_name() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform.startswith("linux"):
        return "linux"
    return platform.system().lower() or sys.platform


def _shell_name() -> str:
    if sys.platform.startswith("win"):
        return os.getenv("COMSPEC", "powershell").split("\\")[-1].lower()
    shell = os.getenv("SHELL", "")
    if shell:
        return Path(shell).name
    return "zsh" if sys.platform == "darwin" else "bash"


def _capabilities(actions: ActionSettings) -> list[str]:
    caps = list(dict.fromkeys(actions.enabled_types))
    if "browser_control" in caps:
        caps.extend(
            [
                "browser_control/select_result",
                "browser_control/extract_dom",
                "browser_control/click_element",
                "browser_control/type_element",
                "browser_control/back",
                "browser_control/forward",
                "browser_control/reload",
            ]
        )
    return caps
