"""config.actions.get / set 흐름을 in-process로 검증.

- /ws 대신 policy 모듈 직접 호출로 round-trip 시뮬
- config.json 임시 파일을 만들어 격리

실행:
    .venv/bin/python -m scripts.verify_config_actions_ws
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from app.actions.policy import actions_to_dict, persist_actions_patch


def _assert(cond: bool, msg: str) -> int:
    print(f"  {'✓' if cond else '✗'} {msg}")
    return 0 if cond else 1


def main() -> int:
    rc = 0

    # 임시 config.json — env로 강제
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = Path(tmp) / "config.json"
        cfg_path.write_text(
            json.dumps(
                {
                    "actions": {
                        "enabled_types": ["notify", "clipboard"],
                        "force_confirm_types": ["terminal"],
                        "terminal": {
                            "enabled": False,
                            "allowed_commands": ["ls"],
                        },
                    }
                },
                indent=2,
            )
        )
        os.environ["USERSPACE_CONFIG_PATH"] = str(cfg_path)

        # 1. 초기 상태 → enabled_types에 terminal 없음
        from app.config import load_settings
        s = load_settings()
        d = actions_to_dict(s.actions)
        rc |= _assert(
            "terminal" not in d["enabled_types"],
            f"초기에는 terminal 비활성 (enabled={d['enabled_types']})",
        )

        # 2. patch: enabled_types에 'terminal'을 추가 → linked로 terminal.enabled도 True가 되어야 함
        new_actions = persist_actions_patch(
            str(cfg_path),
            {"enabled_types": ["notify", "clipboard", "terminal"]},
        )
        rc |= _assert(
            "terminal" in new_actions.enabled_types,
            f"patch 후 enabled_types에 terminal 포함 ({new_actions.enabled_types})",
        )
        rc |= _assert(
            new_actions.terminal.enabled is True,
            f"linked: terminal.enabled=True ({new_actions.terminal.enabled})",
        )
        rc |= _assert(
            new_actions.terminal.allowed_commands == ("ls",),
            f"기존 allowed_commands 보존 ({new_actions.terminal.allowed_commands})",
        )

        # 3. 디스크 직접 읽기 — 실제로 저장됐는지
        on_disk = json.loads(cfg_path.read_text())
        rc |= _assert(
            "terminal" in on_disk["actions"]["enabled_types"]
            and on_disk["actions"]["terminal"]["enabled"] is True,
            "config.json 디스크 반영",
        )

        # 4. force_confirm_types 패치 — terminal 빼기
        new_actions = persist_actions_patch(
            str(cfg_path),
            {"force_confirm_types": []},
        )
        rc |= _assert(
            new_actions.force_confirm_types == (),
            f"force_confirm_types 비움 ({new_actions.force_confirm_types})",
        )

        # 5. enabled_types에서 terminal 제거 → terminal.enabled도 False로 동기화
        new_actions = persist_actions_patch(
            str(cfg_path),
            {"enabled_types": ["notify", "clipboard"]},
        )
        rc |= _assert(
            "terminal" not in new_actions.enabled_types,
            "재패치: terminal 제거",
        )
        rc |= _assert(
            new_actions.terminal.enabled is False,
            f"linked: terminal.enabled=False ({new_actions.terminal.enabled})",
        )
        rc |= _assert(
            new_actions.terminal.allowed_commands == ("ls",),
            "allowed_commands는 여전히 보존",
        )

        # 6. 잘못된 patch 거부
        try:
            persist_actions_patch(str(cfg_path), {"enabled_types": "not-a-list"})
            rc |= _assert(False, "잘못된 patch 거부되어야 함")
        except ValueError:
            rc |= _assert(True, "잘못된 patch 형식은 ValueError")

    print()
    print("=" * 60)
    print("ALL OK — config.actions WS 통로 정상" if rc == 0 else "FAILED")
    print("=" * 60)
    return rc


if __name__ == "__main__":
    sys.exit(main())
