"""Runtime context headers sent to the Controller."""

from __future__ import annotations

import os
import platform
import plistlib
import re
import sys
from pathlib import Path

from app.config import (
    CAPABILITIES_BY_ACTION_TYPE,
    ActionSettings,
    SUPPORTED_ACTION_CAPABILITIES,
)

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
        "X-Client-Supported-Capabilities": ",".join(SUPPORTED_ACTION_CAPABILITIES),
        "X-Client-Action-Contract-Version": ACTION_CONTRACT_VERSION,
        "X-Client-Action-Contract": ACTION_CONTRACT,
        "X-Client-Applications": _applications_header(),
        "X-Client-Terminal-Enabled": "true" if actions.terminal.enabled else "false",
        "X-Client-Terminal-Shell-Path": _shell_path(),
        "X-Client-Terminal-Cwd": _terminal_cwd(actions),
        "X-Client-Terminal-Allowed-Commands": ",".join(actions.terminal.allowed_commands),
        "X-Client-Terminal-Cwd-Allowlist": ",".join(_terminal_allowed_cwds(actions)),
        "X-Client-Terminal-Timeout-Seconds": "20",
    }


def build_runtime_profile(actions: ActionSettings) -> dict[str, object]:
    return {
        "platform": _platform_name(),
        "default_browser": actions.browser.default_browser,
        "capabilities": _capabilities(actions),
        "enabled_capabilities": list(actions.enabled_capabilities),
        "supported_capabilities": list(SUPPORTED_ACTION_CAPABILITIES),
        "applications": list_available_application_profiles(),
        "terminal": {
            "enabled": actions.terminal.enabled,
            "shell": _shell_name(),
            "shell_path": _shell_path(),
            "cwd": _terminal_cwd(actions),
            "allowed_commands": list(actions.terminal.allowed_commands),
            "allowed_cwds": _terminal_allowed_cwds(actions),
            "supports_pty": False,
            "requires_confirm": True,
            "timeout_seconds": 20,
        },
        "metadata": {
            "search_engine": actions.browser.search_engine,
            "timezone": os.getenv("TZ", "Asia/Seoul"),
        },
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


def _shell_path() -> str:
    if sys.platform.startswith("win"):
        return os.getenv("COMSPEC", "")
    shell = os.getenv("SHELL", "")
    if shell:
        return shell
    if sys.platform == "darwin":
        return "/bin/zsh"
    return "/bin/bash"


def _terminal_cwd(actions: ActionSettings) -> str:
    for cwd in _terminal_allowed_cwds(actions):
        if str(cwd).strip():
            return cwd
    return os.getcwd()


def _terminal_allowed_cwds(actions: ActionSettings) -> list[str]:
    return [
        str(Path(cwd).expanduser())
        for cwd in actions.terminal.cwd_allowlist
        if str(cwd).strip()
    ]


def list_available_applications() -> list[str]:
    """Return user-launchable application names for Controller-side personalization."""
    return [item["name"] for item in list_available_application_profiles()]


def application_profiles_from_names(names: list[str]) -> list[dict[str, object]]:
    """Return application profiles for names supplied by the compatibility header."""
    installed = list_available_application_profiles()
    installed_by_key = {
        _app_name_key(str(profile.get("name") or "")): profile
        for profile in installed
    }
    installed_by_key.update(
        {
            _app_name_key(str(alias)): profile
            for profile in installed
            for alias in _string_list(profile.get("aliases"))
        }
    )
    profiles: list[dict[str, object]] = []
    for name in _dedupe_names(names):
        profiles.append(
            installed_by_key.get(_app_name_key(name))
            or _application_profile(name)
        )
    return _dedupe_profiles(profiles)


def list_available_application_profiles() -> list[dict[str, object]]:
    """Return launchable application profiles with exact macOS app names."""
    override = os.getenv("USERSPACE_APPLICATIONS", "").strip()
    if override:
        return [
            _application_profile(name)
            for name in _dedupe_names(override.split(","))
        ]

    profiles: list[dict[str, object]] = []
    for directory in _application_directories():
        try:
            children = list(directory.iterdir())
        except OSError:
            continue
        for child in children:
            if child.suffix.lower() == ".app":
                profiles.append(_application_profile(child.stem, path=str(child)))
    return _dedupe_profiles(profiles)


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


def _application_profile(name: str, *, path: str | None = None) -> dict[str, object]:
    clean_name = str(name).strip()
    plist_metadata = _read_app_plist_metadata(path)
    display_name = str(
        plist_metadata.get("display_name")
        or plist_metadata.get("name")
        or clean_name
    ).strip() or clean_name
    profile: dict[str, object] = {
        "name": clean_name,
        "display_name": display_name,
        "aliases": _application_aliases(clean_name, display_name),
        "kind": "macos_app" if sys.platform == "darwin" else "application",
        "bundle_id": str(plist_metadata.get("bundle_id") or ""),
        "executable": str(plist_metadata.get("executable") or ""),
        "categories": [],
        "capabilities": [],
        "keywords": [],
    }
    if path:
        profile["path"] = path
    return _enrich_application_profile(profile)


def _read_app_plist_metadata(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    plist_path = Path(path) / "Contents" / "Info.plist"
    try:
        with plist_path.open("rb") as fh:
            plist = plistlib.load(fh)
    except Exception:
        return {}

    display_name = (
        plist.get("CFBundleDisplayName")
        or plist.get("CFBundleName")
        or ""
    )
    return {
        "bundle_id": str(plist.get("CFBundleIdentifier") or "").strip(),
        "executable": str(plist.get("CFBundleExecutable") or "").strip(),
        "display_name": str(display_name).strip(),
    }


def _application_aliases(*names: str) -> list[str]:
    aliases: set[str] = set()
    for name in names:
        clean_name = str(name).strip()
        if not clean_name:
            continue
        aliases.add(clean_name)
        aliases.add(clean_name.casefold())
        tokens = re.findall(r"[0-9A-Za-z가-힣]+", clean_name.casefold())
        if tokens:
            aliases.add("".join(tokens))
            aliases.add("_".join(tokens))
    extra_aliases = {
        "Google Chrome": ("Chrome", "chrome"),
        "Microsoft Edge": ("Edge", "edge"),
        "Brave Browser": ("Brave", "brave"),
        "Weather": ("날씨",),
    }
    for name in names:
        aliases.update(extra_aliases.get(str(name).strip(), ()))
    return sorted(aliases, key=str.casefold)


APP_METADATA_BY_BUNDLE_ID: dict[str, dict[str, list[str]]] = {
    "com.apple.weather": {
        "categories": ["weather"],
        "capabilities": ["weather", "forecast", "날씨", "예보"],
        "keywords": ["오늘 날씨", "지역 날씨", "기상"],
    },
}
APP_METADATA_BY_NAME: dict[str, dict[str, list[str]]] = {
    "weather": APP_METADATA_BY_BUNDLE_ID["com.apple.weather"],
}


def _enrich_application_profile(profile: dict[str, object]) -> dict[str, object]:
    metadata = (
        APP_METADATA_BY_BUNDLE_ID.get(str(profile.get("bundle_id") or ""))
        or APP_METADATA_BY_NAME.get(str(profile.get("name") or "").casefold())
        or APP_METADATA_BY_NAME.get(str(profile.get("display_name") or "").casefold())
    )
    if not metadata:
        return profile

    for field in ("categories", "capabilities", "keywords"):
        profile[field] = _merge_string_lists(profile.get(field), metadata.get(field, ()))
    profile["aliases"] = _merge_string_lists(
        profile.get("aliases"),
        [str(profile.get("display_name") or ""), *metadata.get("capabilities", ())],
    )
    return profile


def _merge_string_lists(*values: object) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        for item in _string_list(value):
            key = item.casefold()
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
    return result


def _string_list(value: object) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _app_name_key(value: str) -> str:
    return "".join(ch for ch in value.casefold() if ch.isalnum())


def _dedupe_profiles(values: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[str] = set()
    result: list[dict[str, object]] = []
    for profile in values:
        name = str(profile.get("name") or "").strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(profile)
    return sorted(result, key=lambda item: str(item["name"]).casefold())


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
    derived_capabilities = [
        capability
        for action_type in actions.enabled_types
        for capability in CAPABILITIES_BY_ACTION_TYPE.get(action_type, ())
    ]
    caps = list(
        dict.fromkeys(
            [
                *actions.enabled_types,
                *derived_capabilities,
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
