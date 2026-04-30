"""Terminal command handler with explicit allowlist.

안전 정책:
- enabled=False면 무조건 거부
- shlex로 토큰화 후 allowed_commands 매칭
- cwd가 주어졌다면 cwd_allowlist 안이어야 함 (없으면 cwd 미지정 허용)
- env는 항상 scrub: PATH/HOME/USER/LANG/SHELL/TERM/TMPDIR만 허용 (시크릿 누설 방지)
- 표준출력/오류 8KB 끝부분만 보고
"""

from __future__ import annotations

import asyncio
import os
import shlex
from pathlib import Path
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


_PASSTHROUGH_ENV_KEYS = {
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL",
    "SHELL", "TERM", "TMPDIR", "PWD",
}


def _scrubbed_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k in _PASSTHROUGH_ENV_KEYS}


def _command_allowed(argv: list[str], allowed_commands: tuple[str, ...]) -> bool:
    if not argv:
        return False
    full = " ".join(argv)
    executable = argv[0]
    for allowed in allowed_commands:
        allowed = allowed.strip()
        if not allowed:
            continue
        allowed_argv = shlex.split(allowed)
        if len(allowed_argv) == 1 and executable == allowed_argv[0]:
            return True
        if full == allowed or full.startswith(allowed + " "):
            return True
    return False


def _resolve_allowlist(paths: tuple[str, ...]) -> list[Path]:
    return [Path(p).expanduser().resolve() for p in paths if p.strip()]


def _ensure_cwd_allowed(cwd: Path, allowlist: list[Path]) -> None:
    if not allowlist:
        # cwd_allowlist가 비어있으면 cwd 지정 자체를 거부 (안전한 기본)
        raise HandlerError(
            "terminal cwd not allowed: cwd_allowlist is empty in policy"
        )
    for root in allowlist:
        try:
            cwd.relative_to(root)
            return
        except ValueError:
            continue
    raise HandlerError(f"terminal cwd not under any cwd_allowlist root: {cwd}")


def make_terminal(
    enabled: bool,
    allowed_commands: tuple[str, ...],
    cwd_allowlist: tuple[str, ...] = (),
):
    cwd_roots = _resolve_allowlist(cwd_allowlist)

    async def terminal(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("terminal disabled by policy")
        command = (action.command or action.payload or "").strip()
        if not command:
            raise HandlerError("missing terminal command")
        try:
            argv = shlex.split(command)
        except ValueError as e:
            raise HandlerError(f"invalid terminal command: {e}") from e
        if not _command_allowed(argv, allowed_commands):
            raise HandlerError(f"terminal command not allowed: {argv[0]!r}")

        cwd_str: str | None = None
        cwd_raw = action.args.get("cwd")
        if cwd_raw:
            cwd = Path(str(cwd_raw)).expanduser().resolve()
            _ensure_cwd_allowed(cwd, cwd_roots)
            cwd_str = str(cwd)

        timeout = float(action.args.get("timeout", 30))
        if timeout <= 0 or timeout > 300:
            raise HandlerError("terminal timeout must be in (0, 300] seconds")

        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd_str,
            env=_scrubbed_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError as e:
            proc.kill()
            await proc.communicate()
            raise HandlerError(f"terminal command timed out after {timeout:g}s") from e

        stdout = out.decode("utf-8", errors="replace")
        stderr = err.decode("utf-8", errors="replace")
        if proc.returncode != 0:
            raise HandlerError(
                f"terminal command failed rc={proc.returncode}: {stderr[:500]}"
            )
        return {
            "returncode": proc.returncode,
            "stdout": stdout[-8000:],
            "stderr": stderr[-8000:],
            "truncated": len(stdout) > 8000 or len(stderr) > 8000,
            "cwd": cwd_str,
        }

    return terminal
