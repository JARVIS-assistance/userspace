"""Client action HTTP API 클라이언트.

엔드포인트:
- GET  /client/actions/pending          → list[PendingClientAction]
- POST /client/actions/{action_id}/result → ClientActionResult
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

from app.actions.models import (
    ActionResultStatus,
    ClientActionResult,
    ClientActionResultRequest,
    PendingClientAction,
)

logger = logging.getLogger(__name__)


class APIError(RuntimeError):
    """Generic API failure (HTTP non-2xx that's not 401)."""


class UnauthorizedError(APIError):
    """401 from action endpoints — token invalid/expired. Caller should stop polling."""


class ClientActionAPIClient:
    """aiohttp-based async client for /client/actions/* endpoints."""

    def __init__(
        self,
        base_url: str,
        auth_token: str,
        timeout: float = 30.0,
        client_id: str = "",
        runtime_headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.timeout = timeout
        self.client_id = client_id
        self.runtime_headers = runtime_headers or {}
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                base_url=self.base_url,
                timeout=aiohttp.ClientTimeout(total=self.timeout, connect=10.0),
            )
        return self._session

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }
        if self.client_id:
            h["x-client-id"] = self.client_id
        h.update(self.runtime_headers)
        return h

    # ── Polling ────────────────────────────────────────

    async def fetch_pending(self, limit: int = 20) -> list[PendingClientAction]:
        session = await self._get_session()
        try:
            async with session.get(
                "/client/actions/pending",
                params={"limit": limit},
                headers=self._headers(),
            ) as resp:
                if resp.status == 401:
                    body = await resp.text()
                    sent_headers = list(self._headers().keys())
                    raise UnauthorizedError(
                        f"401 from /client/actions/pending  "
                        f"sent_headers={sent_headers}  "
                        f"resp_body={body[:300]}"
                    )
                if resp.status != 200:
                    body = await resp.text()
                    raise APIError(
                        f"fetch_pending HTTP {resp.status}: {body[:200]}"
                    )
                data = await resp.json()
        except aiohttp.ClientError as e:
            raise APIError(f"fetch_pending network error: {e}") from e

        if isinstance(data, dict):
            for key in ("items", "actions", "pending"):
                value = data.get(key)
                if isinstance(value, list):
                    data = value
                    break

        if not isinstance(data, list):
            logger.warning("fetch_pending returned non-list body: %r", data)
            return []

        result: list[PendingClientAction] = []
        for raw in data:
            try:
                result.append(PendingClientAction.model_validate(raw))
            except Exception as e:
                logger.warning("skipping malformed PendingClientAction: %s; raw=%r", e, raw)
        return result

    # ── Result submission ─────────────────────────────

    async def submit_result(
        self,
        action_id: str,
        status: ActionResultStatus,
        output: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> ClientActionResult | None:
        session = await self._get_session()
        body = ClientActionResultRequest(
            status=status,
            output=output or {},
            error=error,
        ).model_dump()
        try:
            async with session.post(
                f"/client/actions/{action_id}/result",
                json=body,
                headers=self._headers(),
            ) as resp:
                if resp.status == 401:
                    rb = await resp.text()
                    raise UnauthorizedError(
                        f"401 from /client/actions/{action_id}/result  resp_body={rb[:300]}"
                    )
                if resp.status not in (200, 201):
                    body_text = await resp.text()
                    logger.error(
                        "submit_result HTTP %s for action_id=%s: %s",
                        resp.status,
                        action_id,
                        body_text[:200],
                    )
                    return None
                data = await resp.json()
        except aiohttp.ClientError as e:
            logger.error("submit_result network error for %s: %s", action_id, e)
            return None

        try:
            return ClientActionResult.model_validate(data)
        except Exception as e:
            logger.warning("submit_result returned malformed body: %s; raw=%r", e, data)
            return None

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None
