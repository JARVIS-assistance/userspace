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
import time
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
        raise HandlerError(
            "terminal cwd not allowed: cwd_allowlist is empty in policy"
        )
    for root in allowlist:
        if cwd == root:
            return
    raise HandlerError(f"terminal cwd not allowed: {cwd}")


def make_terminal(
    enabled: bool,
    allowed_commands: tuple[str, ...],
    cwd_allowlist: tuple[str, ...] = (),
):
    cwd_roots = _resolve_allowlist(cwd_allowlist)

    async def terminal(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("terminal disabled by policy")
        command = _terminal_command(action)
        cwd_str = _terminal_cwd_value(action, cwd_roots)
        output_context = {
            "command": command,
            "cwd": cwd_str,
            "shell": _terminal_shell(action),
            "source": "terminal",
        }
        try:
            _ensure_cwd_allowed(Path(cwd_str).resolve(), cwd_roots)
        except HandlerError as e:
            raise HandlerError(str(e), output=output_context) from e
        if not command:
            raise HandlerError("Missing terminal command", output=output_context)
        try:
            argv = shlex.split(command)
        except ValueError as e:
            raise HandlerError(
                f"Invalid terminal command: {e}",
                output=output_context,
            ) from e
        if not _command_allowed(argv, allowed_commands):
            raise HandlerError("Command is not allowed", output=output_context)

        timeout = float(action.args.get("timeout", 20))
        if timeout <= 0 or timeout > 300:
            raise HandlerError(
                "Terminal timeout must be in (0, 300] seconds",
                output=output_context,
            )

        started = time.monotonic()
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
            raise HandlerError(
                f"Terminal command timed out after {timeout:g}s",
                output=output_context,
            ) from e

        stdout = out.decode("utf-8", errors="replace")
        stderr = err.decode("utf-8", errors="replace")
        duration_ms = int((time.monotonic() - started) * 1000)
        result = {
            **output_context,
            "exit_code": proc.returncode,
            "returncode": proc.returncode,
            "stdout": stdout[-8000:],
            "stderr": stderr[-8000:],
            "duration_ms": duration_ms,
            "truncated": len(stdout) > 8000 or len(stderr) > 8000,
        }
        if proc.returncode != 0:
            raise HandlerError(
                f"Terminal command failed rc={proc.returncode}: {stderr[:500]}",
                output=result,
            )
        return result

    return terminal


def _terminal_cwd_value(action: ClientAction, cwd_roots: list[Path]) -> str:
    cwd_raw = action.args.get("cwd")
    if cwd_raw:
        cwd = Path(str(cwd_raw)).expanduser().resolve()
    elif cwd_roots:
        cwd = cwd_roots[0]
    else:
        cwd = Path.cwd().resolve()
    return str(cwd)


def _terminal_shell(action: ClientAction) -> str:
    target = str(action.target or "").strip()
    if target:
        return Path(target).name
    shell = os.getenv("SHELL", "")
    if shell:
        return Path(shell).name
    return "zsh" if os.sys.platform == "darwin" else "bash"


def _terminal_command(action: ClientAction) -> str:
    args = action.args or {}
    raw = args.get("command")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    if action.payload and action.payload.strip():
        return action.payload.strip()
    command = (action.command or "").strip()
    if command and command not in {"execute", "run"}:
        return command
    return ""
