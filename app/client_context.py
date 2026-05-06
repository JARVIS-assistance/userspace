"""Runtime context headers sent to the Controller."""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

from app.config import ActionSettings, SUPPORTED_ACTION_CAPABILITIES

MAX_APPLICATION_HEADER_BYTES = 6000
ACTION_CONTRACT_VERSION = "1.0"
ACTION_CONTRACT = (
    "Client executes only queued action_dispatch envelopes with action_id. "
    "Do not place action JSON in assistant text. "
    "For browser page/search/navigation requests, dispatch open_url with an http(s) URL. "
    "For current-page browser interaction, dispatch browser_control commands. "
    "If no action_dispatch is emitted, the client will not execute the action."
)


def build_runtime_headers(actions: ActionSettings) -> dict[str, str]:
    return {
        "X-Client-Platform": _platform_name(),
        "X-Client-Shell": _shell_name(),
        "X-Client-Browser": actions.browser.default_browser,
        "X-Client-Search-Engine": actions.browser.search_engine,
        "X-Client-Timezone": os.getenv("TZ", "Asia/Seoul"),
        "X-Client-Calendar-Provider": os.getenv(
            "USERSPACE_CALENDAR_PROVIDER",
            "none",
        ),
        "X-Client-Capabilities": ",".join(_capabilities(actions)),
        "X-Client-Enabled-Capabilities": ",".join(actions.enabled_capabilities),
        "X-Client-Action-Contract-Version": ACTION_CONTRACT_VERSION,
        "X-Client-Action-Contract": ACTION_CONTRACT,
        "X-Client-Applications": _applications_header(),
        "X-Client-Terminal-Enabled": "true" if actions.terminal.enabled else "false",
        "X-Client-Terminal-Allowed-Commands": ",".join(actions.terminal.allowed_commands),
        "X-Client-Terminal-Cwd-Allowlist": ",".join(actions.terminal.cwd_allowlist),
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


def list_available_applications() -> list[str]:
    """Return user-launchable application names for Controller-side personalization."""
    override = os.getenv("USERSPACE_APPLICATIONS", "").strip()
    if override:
        return _dedupe_names(override.split(","))

    names: list[str] = []
    for directory in _application_directories():
        try:
            children = list(directory.iterdir())
        except OSError:
            continue
        for child in children:
            if child.suffix.lower() == ".app":
                names.append(child.stem)
    return _dedupe_names(names)


def _application_directories() -> list[Path]:
    override = os.getenv("USERSPACE_APPLICATION_DIRS", "").strip()
    if override:
        return [Path(item).expanduser() for item in override.split(":") if item.strip()]
    if sys.platform == "darwin":
        return [
            Path("/Applications"),
            Path.home() / "Applications",
            Path("/System/Applications"),
            Path("/System/Applications/Utilities"),
        ]
    return []


def _applications_header() -> str:
    names = list_available_applications()
    value = ",".join(names)
    while len(value.encode("utf-8")) > MAX_APPLICATION_HEADER_BYTES and names:
        names.pop()
        value = ",".join(names)
    return value


def _dedupe_names(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        name = str(value).strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(name)
    return sorted(result, key=str.casefold)


def _capabilities(actions: ActionSettings) -> list[str]:
    caps = list(
        dict.fromkeys(
            [
                *actions.enabled_types,
                *SUPPORTED_ACTION_CAPABILITIES,
                *actions.enabled_capabilities,
            ]
        )
    )
    if "terminal.run" in caps:
        caps.append("terminal/execute")
    if "browser.extract_dom" in caps or "browser_control" in caps:
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
    return list(dict.fromkeys(caps))
