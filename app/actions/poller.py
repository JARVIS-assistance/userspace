"""ActionPoller — /client/actions/pending 폴링 + dispatch + 결과 POST.

전략:
- slow_interval (기본 2.0s)로 평상시 폴링
- SSE에서 conversation.action_dispatch 받으면 wake() 호출 → 즉시 폴링 + fast_interval 모드
- fast_mode_duration 동안 fast_interval로 폴링, 이후 slow로 복귀
- 401(Unauthorized) → 폴러 정지
- 5xx/네트워크 → exponential backoff (max 30s)
- 같은 action_id를 두 번 처리하지 않도록 in-memory 캡 유지(256)
"""

from __future__ import annotations

import asyncio
import collections
import logging
import time

from app.actions.api_client import (
    APIError,
    ClientActionAPIClient,
    UnauthorizedError,
)
from app.actions.dispatcher import ActionDispatcher
from app.actions.models import PendingClientAction

logger = logging.getLogger(__name__)


class ActionPoller:
    def __init__(
        self,
        *,
        api: ClientActionAPIClient,
        dispatcher: ActionDispatcher,
        slow_interval_sec: float = 1.5,
        fast_interval_sec: float = 0.25,
        fast_mode_duration_sec: float = 10.0,
        seen_cap: int = 256,
    ) -> None:
        self.api = api
        self.dispatcher = dispatcher
        self.slow_interval = slow_interval_sec
        self.fast_interval = fast_interval_sec
        self.fast_mode_duration = fast_mode_duration_sec

        self._task: asyncio.Task[None] | None = None
        self._stop_evt = asyncio.Event()
        self._wake_evt = asyncio.Event()
        self._fast_until: float = 0.0
        self._seen: collections.OrderedDict[str, None] = collections.OrderedDict()
        self._seen_cap = seen_cap
        self._inflight: set[asyncio.Task[None]] = set()

    # ── 라이프사이클 ───────────────────────────────────

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop_evt.clear()
            self._wake_evt.clear()
            print(
                f"[POLL] start  base={self.api.base_url}  "
                f"slow={self.slow_interval}s  fast={self.fast_interval}s",
                flush=True,
            )
            self._task = asyncio.create_task(self._run(), name="action_poller")

    async def stop(self) -> None:
        self._stop_evt.set()
        self._wake_evt.set()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        # 실행중인 dispatch 마무리 대기 (최대 5초)
        if self._inflight:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self._inflight, return_exceptions=True),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.warning("ActionPoller.stop: in-flight dispatches still running, abandoning")

        await self.api.close()

    def wake(self) -> None:
        """SSE action_dispatch 수신 시 호출. 즉시 폴 + fast 모드 진입."""
        self._fast_until = time.time() + self.fast_mode_duration
        self._wake_evt.set()

    def dispatch_pending(self, pending: PendingClientAction) -> bool:
        """Dispatch a known pending action from SSE without polling the queue."""
        if self._is_seen(pending.action_id):
            return False
        self._mark_seen(pending.action_id)
        self._spawn_dispatch(pending)
        return True

    async def dispatch_pending_now(self, pending: PendingClientAction) -> bool:
        """Dispatch an SSE action and submit its result before reading more SSE."""
        if self._is_seen(pending.action_id):
            return False
        self._mark_seen(pending.action_id)
        await self._handle_one(pending)
        return True

    # ── 메인 루프 ──────────────────────────────────────

    async def _run(self) -> None:
        backoff = 1.0
        first_ok = False
        consecutive_zero = 0
        while not self._stop_evt.is_set():
            try:
                pendings = await self.api.fetch_pending()
                backoff = 1.0  # reset on success
                if not first_ok:
                    print(
                        f"[POLL] connected  GET /client/actions/pending  → {len(pendings)} item(s)",
                        flush=True,
                    )
                    first_ok = True
                if pendings:
                    print(f"[POLL] +{len(pendings)} pending", flush=True)
                    consecutive_zero = 0
                else:
                    consecutive_zero += 1
                for pending in pendings:
                    if self._is_seen(pending.action_id):
                        continue
                    self._mark_seen(pending.action_id)
                    self._spawn_dispatch(pending)
                interval = (
                    self.fast_interval
                    if time.time() < self._fast_until
                    else self.slow_interval
                )
            except UnauthorizedError as e:
                print(f"[POLL] 401 → stop ({e})", flush=True)
                logger.error("ActionPoller: 401, stopping. %s", e)
                return
            except APIError as e:
                print(f"[POLL] err: {e}  (backoff {backoff:.1f}s)", flush=True)
                logger.warning("ActionPoller: API error '%s', backoff %.1fs", e, backoff)
                interval = backoff
                backoff = min(backoff * 2.0, 30.0)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[POLL] unexpected: {type(e).__name__}: {e}", flush=True)
                logger.exception("ActionPoller: unexpected: %s", e)
                interval = backoff
                backoff = min(backoff * 2.0, 30.0)

            self._wake_evt.clear()
            try:
                await asyncio.wait_for(self._wake_evt.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass

    # ── per-action 처리 ───────────────────────────────

    def _spawn_dispatch(self, pending: PendingClientAction) -> None:
        task = asyncio.create_task(
            self._handle_one(pending),
            name=f"action_dispatch_{pending.action_id}",
        )
        self._inflight.add(task)
        task.add_done_callback(self._inflight.discard)

    async def _handle_one(self, pending: PendingClientAction) -> None:
        a = pending.action
        print(
            f"[POLL] dispatch  id={pending.action_id[:12]}…  "
            f"type={a.type}  desc={a.description[:40]!r}",
            flush=True,
        )
        try:
            status, output, error = await self.dispatcher.dispatch(pending)
        except Exception as e:
            logger.exception("dispatcher.dispatch raised for %s: %s", pending.action_id, e)
            status, output, error = "failed", {}, f"client error: {e}"

        print(
            f"[POLL] result    id={pending.action_id[:12]}…  "
            f"status={status}  err={error or '-'}",
            flush=True,
        )
        try:
            await self.api.submit_result(
                action_id=pending.action_id,
                status=status,
                output=output,
                error=error,
            )
        except UnauthorizedError as e:
            print(f"[POLL] 401 on submit_result → stop ({e})", flush=True)
            logger.error("ActionPoller: 401 on submit_result, stopping. %s", e)
            self._stop_evt.set()
            self._wake_evt.set()
        except Exception as e:
            print(f"[POLL] submit_result failed: {e}", flush=True)
            logger.exception("submit_result failed for %s: %s", pending.action_id, e)

    # ── seen-set (in-memory FIFO cap) ─────────────────

    def _is_seen(self, action_id: str) -> bool:
        return action_id in self._seen

    def _mark_seen(self, action_id: str) -> None:
        self._seen[action_id] = None
        while len(self._seen) > self._seen_cap:
            self._seen.popitem(last=False)
