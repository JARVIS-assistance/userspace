"""ActionSettings ↔ JSON dict 변환과 config.json 영속화.

UI에서 토글한 결과를 받아 config.json에 머지 후 저장하고, 새 ActionSettings를 돌려준다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import ActionSettings, load_settings


# UI에 보여줄 모든 알려진 type
ALL_ACTION_TYPES: tuple[str, ...] = (
    "notify",
    "clipboard",
    "open_url",
    "browser_control",
    "app_control",
    "web_search",
    "file_read",
    "file_write",
    "terminal",
    "screenshot",
    "mouse_click",
    "mouse_drag",
    "keyboard_type",
    "hotkey",
)

# enabled_types 토글이 핸들러 enabled 플래그도 함께 끄고 켜는 매핑
# (예: "terminal" 토글 ON → enabled_types에 추가 + terminal.enabled=True)
_LINKED_FLAGS: dict[str, str] = {
    "terminal": "terminal",
    "app_control": "app_control",
    "browser_control": "browser_control",
    "web_search": "web_search",
    "screenshot": "screenshot",
    "mouse_click": "physical_input",
    "mouse_drag": "physical_input",
    "keyboard_type": "physical_input",
    "hotkey": "physical_input",
}


def actions_to_dict(actions: ActionSettings) -> dict[str, Any]:
    """ActionSettings를 UI/JSON에 보낼 dict로 변환."""
    return {
        "all_types": list(ALL_ACTION_TYPES),
        "enabled_types": list(actions.enabled_types),
        "force_confirm_types": list(actions.force_confirm_types),
        "file_write": {
            "allowed_paths": list(actions.file_write.allowed_paths),
            "max_bytes": actions.file_write.max_bytes,
        },
        "terminal": {
            "enabled": actions.terminal.enabled,
            "allowed_commands": list(actions.terminal.allowed_commands),
            "cwd_allowlist": list(actions.terminal.cwd_allowlist),
        },
        "physical_input": {
            "enabled": actions.physical_input.enabled,
            "max_keystroke_chars": actions.physical_input.max_keystroke_chars,
        },
        "app_control": {"enabled": actions.app_control.enabled},
        "browser_control": {"enabled": actions.browser_control.enabled},
        "web_search": {"enabled": actions.web_search.enabled},
        "screenshot": {
            "enabled": actions.screenshot.enabled,
            "allowed_paths": list(actions.screenshot.allowed_paths),
        },
    }


def _is_list_of_strings(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def _validate_patch(patch: dict[str, Any]) -> None:
    if not isinstance(patch, dict):
        raise ValueError("patch must be an object")
    if "enabled_types" in patch and not _is_list_of_strings(patch["enabled_types"]):
        raise ValueError("enabled_types must be a list of strings")
    if "force_confirm_types" in patch and not _is_list_of_strings(
        patch["force_confirm_types"]
    ):
        raise ValueError("force_confirm_types must be a list of strings")
    for key in ("file_write", "terminal", "physical_input", "screenshot"):
        if key in patch and not isinstance(patch[key], dict):
            raise ValueError(f"{key} must be an object")
    for key in ("app_control", "browser_control", "web_search"):
        if key in patch and not isinstance(patch[key], dict):
            raise ValueError(f"{key} must be an object")


def _propagate_linked_flags(patch: dict[str, Any]) -> dict[str, Any]:
    """enabled_types 토글 결과로 핸들러 enabled 플래그도 동기화.

    UI는 단일 'enabled' 토글을 누르고 싶을 뿐이므로 여기서 자동 매칭.
    """
    if "enabled_types" not in patch:
        return patch
    enabled_set = set(patch["enabled_types"])
    out = dict(patch)
    # 각 linked flag 그룹별로 enabled 결정
    flag_states: dict[str, bool] = {}
    for action_type, flag_key in _LINKED_FLAGS.items():
        if action_type in enabled_set:
            flag_states[flag_key] = True
        else:
            flag_states.setdefault(flag_key, False)
    for flag_key, on in flag_states.items():
        existing = dict(out.get(flag_key, {}))
        existing["enabled"] = bool(on)
        out[flag_key] = existing
    return out


def _merge_into_config(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """config.json의 actions 섹션 dict에 patch를 머지 (top-level 교체, sub-object update)."""
    actions = dict(existing)

    for key in ("enabled_types", "force_confirm_types"):
        if key in patch:
            actions[key] = list(patch[key])

    for key in (
        "file_write",
        "terminal",
        "physical_input",
        "app_control",
        "browser_control",
        "web_search",
        "screenshot",
    ):
        if key in patch:
            current = dict(actions.get(key, {}))
            current.update(patch[key])
            actions[key] = current

    return actions


def persist_actions_patch(config_path: str, patch: dict[str, Any]) -> ActionSettings:
    """patch를 검증한 뒤 config.json에 영속화하고, 새 Settings의 actions를 반환.

    - 항상 atomic write (.tmp → rename)
    - 라이브 settings global도 같이 갱신
    - 반환은 갱신된 ActionSettings
    """
    _validate_patch(patch)
    propagated = _propagate_linked_flags(patch)

    path = Path(config_path)
    raw: dict[str, Any] = {}
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raw = {}
        except json.JSONDecodeError as e:
            raise ValueError(f"existing config.json is not valid JSON: {e}") from e

    raw_actions = raw.get("actions") if isinstance(raw.get("actions"), dict) else {}
    raw["actions"] = _merge_into_config(raw_actions, propagated)

    serialized = json.dumps(raw, ensure_ascii=False, indent=2)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(serialized + "\n", encoding="utf-8")
    tmp.replace(path)

    new_settings = load_settings(config_path)
    return new_settings.actions
