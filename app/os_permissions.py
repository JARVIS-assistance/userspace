from __future__ import annotations

import asyncio
import sys
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class MacOSPermissionStatus:
    platform: str
    checked: bool
    automation_granted: bool | None
    reason: str | None = None
    message: str | None = None

    def model_dump(self) -> dict[str, object | None]:
        return asdict(self)


async def request_macos_action_permissions(timeout: float = 3.0) -> MacOSPermissionStatus:
    """Trigger macOS Automation/Accessibility prompts without sending input."""

    if sys.platform != "darwin":
        return MacOSPermissionStatus(
            platform=sys.platform,
            checked=False,
            automation_granted=None,
            reason="unsupported_platform",
        )

    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript",
            "-e",
            'tell application "System Events" to get name of first process',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        if proc is not None and proc.returncode is None:
            proc.kill()
            await proc.wait()
        return MacOSPermissionStatus(
            platform=sys.platform,
            checked=True,
            automation_granted=False,
            reason="permission_prompt_timeout",
            message="macOS permission prompt did not complete before startup timeout",
        )
    except FileNotFoundError:
        return MacOSPermissionStatus(
            platform=sys.platform,
            checked=True,
            automation_granted=False,
            reason="osascript_missing",
        )

    if proc.returncode == 0:
        return MacOSPermissionStatus(
            platform=sys.platform,
            checked=True,
            automation_granted=True,
        )

    message = stderr.decode(errors="replace").strip()[:300]
    return MacOSPermissionStatus(
        platform=sys.platform,
        checked=True,
        automation_granted=False,
        reason=_osascript_permission_reason(message),
        message=message,
    )


def _osascript_permission_reason(message: str) -> str:
    lowered = message.casefold()
    if (
        "system events" in lowered
        or "not authorized" in lowered
        or "accessibility" in lowered
        or "허용되지 않습니다" in lowered
        or "연결이 유효하지 않습니다" in lowered
        or "not allowed assistive access" in lowered
    ):
        return "os_permission_missing"
    return "execution_failed"
