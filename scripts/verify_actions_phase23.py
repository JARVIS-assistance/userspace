"""Phase 2 + 3 검증 — 정책 게이트와 핸들러 안전망.

검증 항목:
1. dispatcher.enabled_types에 없는 type → status=failed, error='disabled by policy'
2. dispatcher.force_confirm_types 안의 type은 requires_confirm=False라도 컨펌 모달 발생
3. file_write — max_bytes 초과 → failed
4. file_write — allowed_paths 밖 경로 → failed
5. terminal — cwd_allowlist 미설정 + cwd 지정 → failed
6. terminal — allowed_commands 매칭 안 됨 → failed

실행:
    .venv/bin/python -m scripts.verify_actions_phase23
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path
from typing import Any

from app.actions.dispatcher import ActionDispatcher
from app.actions.handlers.file_ops import make_file_read, make_file_write
from app.actions.handlers.terminal import make_terminal
from app.actions.models import ClientAction, PendingClientAction
from app.models.messages import EventEnvelope


# ── 헬퍼 ──────────────────────────────────────────────


def _assert(cond: bool, msg: str) -> int:
    if not cond:
        print(f"  ✗ {msg}")
        return 1
    print(f"  ✓ {msg}")
    return 0


async def _run(
    dispatcher: ActionDispatcher,
    action: ClientAction,
    action_id: str = "act_test",
    request_id: str = "req_test",
) -> tuple[str, dict[str, Any], str | None, list[EventEnvelope]]:
    pending = PendingClientAction(
        action_id=action_id,
        request_id=request_id,
        action=action,
    )
    status, output, error = await dispatcher.dispatch(pending)
    return status, output, error, []


# ── 시나리오 ──────────────────────────────────────────


async def run_scenarios() -> int:
    rc = 0

    # ── [1] enabled_types 정책 ────────────────────────
    print()
    print("[1] dispatcher.enabled_types에 없는 type → failed by policy")
    emitted: list[EventEnvelope] = []

    async def emit(env: EventEnvelope) -> None:
        emitted.append(env)

    d = ActionDispatcher(
        emit=emit,
        enabled_types={"notify", "clipboard"},
        force_confirm_types=set(),
    )
    # terminal 핸들러 등록은 했지만 enabled_types에 없음
    d.register("terminal", lambda a: asyncio.sleep(0))  # type: ignore[arg-type]

    status, _, error, _ = await _run(
        d,
        ClientAction(type="terminal", description="ls", requires_confirm=False),
        action_id="act_pol_1",
    )
    rc |= _assert(status == "failed", f"status=failed (got {status})")
    rc |= _assert(
        "disabled by policy" in (error or ""),
        f"error mentions disabled by policy (got {error!r})",
    )

    # ── [2] force_confirm_types ───────────────────────
    print()
    print("[2] force_confirm_types에 든 type은 requires_confirm=False여도 컨펌 발생")
    emitted2: list[EventEnvelope] = []

    async def emit2(env: EventEnvelope) -> None:
        emitted2.append(env)

    async def stub(_action: ClientAction) -> dict[str, Any]:
        return {"ok": True}

    d2 = ActionDispatcher(
        emit=emit2,
        enabled_types={"keyboard_type"},
        force_confirm_types={"keyboard_type"},
        confirm_timeout_sec=1.0,
    )
    d2.register("keyboard_type", stub)

    # 백그라운드로 dispatch 시작 → client_action.pending이 emit되는지 확인 → confirm
    pending = PendingClientAction(
        action_id="act_force_1",
        request_id="req",
        action=ClientAction(
            type="keyboard_type",
            description="type me",
            requires_confirm=False,  # ← 백엔드는 false라 했지만
        ),
    )
    task = asyncio.create_task(d2.dispatch(pending))

    # client_action.pending이 emit될 때까지 대기 (force_confirm이 작동하면)
    deadline = asyncio.get_event_loop().time() + 0.5
    saw_pending = False
    while asyncio.get_event_loop().time() < deadline:
        if any(
            e.type == "client_action.pending" and e.payload.get("action_id") == "act_force_1"
            for e in emitted2
        ):
            saw_pending = True
            break
        await asyncio.sleep(0.02)

    rc |= _assert(saw_pending, "client_action.pending emit됨 (force_confirm 발동)")
    d2.confirm("act_force_1", True)
    status, _, _ = await task
    rc |= _assert(status == "completed", f"승인 후 completed (got {status})")

    # ── [3] file_write max_bytes ──────────────────────
    print()
    print("[3] file_write: payload가 max_bytes 초과 → failed")
    with tempfile.TemporaryDirectory() as tmp:
        d3 = ActionDispatcher(emit=emit, enabled_types=None, force_confirm_types=set())
        d3.register("file_write", make_file_write((tmp,), max_bytes=64))
        big = "x" * 200
        status, _, error, _ = await _run(
            d3,
            ClientAction(
                type="file_write",
                target=str(Path(tmp) / "big.txt"),
                payload=big,
                description="too big",
                requires_confirm=False,
            ),
            action_id="act_fw_1",
        )
        rc |= _assert(status == "failed", f"oversize → failed (got {status})")
        rc |= _assert(
            "max_bytes" in (error or ""),
            f"error mentions max_bytes (got {error!r})",
        )

        # ── [4] file_write allowed_paths 밖 ──────────
        print()
        print("[4] file_write: allowed_paths 밖 경로 → failed")
        outside = "/tmp/nonexistent_jarvis_test/out.txt"
        status, _, error, _ = await _run(
            d3,
            ClientAction(
                type="file_write",
                target=outside,
                payload="hi",
                description="outside",
                requires_confirm=False,
            ),
            action_id="act_fw_2",
        )
        rc |= _assert(status == "failed", f"outside → failed (got {status})")
        rc |= _assert(
            "denied" in (error or "").lower(),
            f"error mentions denied (got {error!r})",
        )

    # ── [5] terminal cwd_allowlist 미설정 ─────────────
    print()
    print("[5] terminal: cwd 지정 + cwd_allowlist 비어있음 → failed")
    d5 = ActionDispatcher(emit=emit, enabled_types=None, force_confirm_types=set())
    d5.register("terminal", make_terminal(enabled=True, allowed_commands=("ls",), cwd_allowlist=()))

    status, _, error, _ = await _run(
        d5,
        ClientAction(
            type="terminal",
            command="ls",
            args={"cwd": "/tmp"},
            description="ls in /tmp",
            requires_confirm=False,
        ),
        action_id="act_term_1",
    )
    rc |= _assert(status == "failed", f"empty cwd_allowlist → failed (got {status})")
    rc |= _assert(
        "cwd" in (error or "").lower(),
        f"error mentions cwd (got {error!r})",
    )

    # ── [6] terminal allowed_commands 매칭 안 됨 ──────
    print()
    print("[6] terminal: allowed_commands 미매칭 → failed")
    d6 = ActionDispatcher(emit=emit, enabled_types=None, force_confirm_types=set())
    d6.register("terminal", make_terminal(enabled=True, allowed_commands=("ls",), cwd_allowlist=()))

    status, _, error, _ = await _run(
        d6,
        ClientAction(
            type="terminal",
            command="rm -rf /",
            description="evil",
            requires_confirm=False,
        ),
        action_id="act_term_2",
    )
    rc |= _assert(status == "failed", f"disallowed cmd → failed (got {status})")
    rc |= _assert(
        "not allowed" in (error or "").lower(),
        f"error mentions 'not allowed' (got {error!r})",
    )

    print()
    print("=" * 60)
    if rc == 0:
        print("ALL OK — Phase 2/3 정책 게이트 정상")
    else:
        print("FAILED")
    print("=" * 60)
    return rc


def main() -> int:
    return asyncio.run(run_scenarios())


if __name__ == "__main__":
    sys.exit(main())
