"""Handler base types — 핸들러는 ClientAction을 받아 dict(output)을 반환하거나 HandlerError를 raise.

규약:
- 정상 완료 → dict (status=completed)
- 의도된 실패 → raise HandlerError(msg) (status=failed, error=msg)
- 예상치 못한 예외 → 자동으로 status=failed, error=repr(exc)
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.actions.models import ClientAction


class HandlerError(Exception):
    """의도된 실패. dispatcher가 status=failed + error=str(exc)로 보고."""

    def __init__(self, message: str, output: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.output = output or {}


# Handler signature
Handler = Callable[[ClientAction], Awaitable[dict[str, Any]]]
