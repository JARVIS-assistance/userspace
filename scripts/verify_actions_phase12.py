"""Phase 1.2 검증 — fake API 서버 + 실 dispatcher/poller로 end-to-end 시뮬.

검증 항목:
1. /pending → 액션 한 건 → dispatcher가 핸들러 실행 → /result POST
2. requires_confirm=true 액션 → client_action.pending emit → confirm() → completed
3. requires_confirm=true + reject → status=rejected, error="user rejected confirmation"
4. 핸들러 미등록 type → status=failed, error="no handler registered..."
5. 핸들러 raise HandlerError → status=failed, error=메시지
6. requires_confirm=true + timeout → status=timeout
7. 같은 action_id 중복 들어와도 한 번만 dispatch
8. 401 → poller 자동 정지

실행:
    .venv/bin/python -m scripts.verify_actions_phase12
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from aiohttp import web

from app.actions.api_client import ClientActionAPIClient
from app.actions.dispatcher import ActionDispatcher
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction, PendingClientAction
from app.actions.poller import ActionPoller
from app.models.messages import EventEnvelope


# ── Fake API 서버 ─────────────────────────────────────


class FakeBackend:
    def __init__(self) -> None:
        self.queue: list[dict[str, Any]] = []
        self.results: list[dict[str, Any]] = []
        self.unauthorized = False
        self.delivered_ids: set[str] = set()

    def enqueue(self, action_id: str, action: ClientAction, request_id: str = "req_test") -> None:
        self.queue.append(
            {
                "contract_version": "1.0",
                "action_id": action_id,
                "request_id": request_id,
                "action": action.model_dump(),
            }
        )

    async def handle_pending(self, request: web.Request) -> web.Response:
        if self.unauthorized:
            return web.json_response({"error": "unauthorized"}, status=401)
        # 큐에 남아있는 것만 한 번씩 전달
        to_send = [q for q in self.queue if q["action_id"] not in self.delivered_ids]
        for q in to_send:
            self.delivered_ids.add(q["action_id"])
        return web.json_response(to_send)

    async def handle_result(self, request: web.Request) -> web.Response:
        if self.unauthorized:
            return web.json_response({"error": "unauthorized"}, status=401)
        action_id = request.match_info["action_id"]
        body = await request.json()
        body["action_id"] = action_id
        body["request_id"] = "req_test"
        self.results.append(body)
        # 큐에서 제거 (재전달 방지)
        self.queue = [q for q in self.queue if q["action_id"] != action_id]
        return web.json_response(body)


# ── 테스트 핸들러 ─────────────────────────────────────


async def stub_completed(action: ClientAction) -> dict[str, Any]:
    return {"echo": action.description}


async def stub_failing(action: ClientAction) -> dict[str, Any]:
    raise HandlerError("intentional failure")


# ── 헬퍼 ──────────────────────────────────────────────


async def _spin_until(cond, timeout: float = 3.0, hint: str = "") -> bool:
    """cond()가 True가 될 때까지 대기."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if cond():
            return True
        await asyncio.sleep(0.05)
    print(f"  TIMEOUT: {hint}")
    return False


def _assert(cond: bool, msg: str) -> int:
    if not cond:
        print(f"  ✗ {msg}")
        return 1
    print(f"  ✓ {msg}")
    return 0


def _result_for(backend: FakeBackend, action_id: str) -> dict[str, Any] | None:
    for r in backend.results:
        if r.get("action_id") == action_id:
            return r
    return None


# ── 시나리오 ──────────────────────────────────────────


async def run_scenarios() -> int:
    rc = 0
    backend = FakeBackend()

    app = web.Application()
    app.router.add_get("/client/actions/pending", backend.handle_pending)
    app.router.add_post("/client/actions/{action_id}/result", backend.handle_result)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[attr-defined]
    base_url = f"http://127.0.0.1:{port}"

    # dispatcher / api / poller
    emitted: list[EventEnvelope] = []

    async def emit(env: EventEnvelope) -> None:
        emitted.append(env)

    dispatcher = ActionDispatcher(emit=emit, confirm_timeout_sec=2.0)
    dispatcher.register("notify", stub_completed)
    dispatcher.register("clipboard", stub_failing)

    api = ClientActionAPIClient(base_url=base_url, auth_token="test-token", timeout=5)
    poller = ActionPoller(
        api=api,
        dispatcher=dispatcher,
        slow_interval_sec=0.2,
        fast_interval_sec=0.05,
    )
    poller.start()

    try:
        # ── 시나리오 1: requires_confirm=False, 핸들러 등록됨 → completed ──
        print()
        print("[1] requires_confirm=False, 핸들러 등록 → completed")
        backend.enqueue(
            "act_1",
            ClientAction(
                type="notify",
                description="test notify",
                requires_confirm=False,
            ),
        )
        await _spin_until(lambda: _result_for(backend, "act_1") is not None,
                          hint="act_1 result")
        r = _result_for(backend, "act_1") or {}
        rc |= _assert(r.get("status") == "completed", f"status=completed (got {r.get('status')})")
        rc |= _assert(r.get("output", {}).get("echo") == "test notify",
                      f"output echo (got {r.get('output')})")

        emitted_types_1 = [e.type for e in emitted if e.payload.get("action_id") == "act_1"]
        rc |= _assert(
            "client_action.started" in emitted_types_1
            and "client_action.completed" in emitted_types_1,
            f"emitted started+completed (got {emitted_types_1})",
        )

        # ── 시나리오 2: 핸들러 미등록 type → failed ──
        print()
        print("[2] 핸들러 미등록 type='terminal' → failed")
        backend.enqueue(
            "act_2",
            ClientAction(type="terminal", description="rm -rf /", requires_confirm=False),
        )
        await _spin_until(lambda: _result_for(backend, "act_2") is not None,
                          hint="act_2 result")
        r = _result_for(backend, "act_2") or {}
        rc |= _assert(r.get("status") == "failed", f"status=failed (got {r.get('status')})")
        rc |= _assert(
            "no handler registered" in (r.get("error") or ""),
            f"error mentions no handler (got {r.get('error')!r})",
        )

        # ── 시나리오 3: HandlerError → failed ──
        print()
        print("[3] HandlerError raise → failed + error msg")
        backend.enqueue(
            "act_3",
            ClientAction(type="clipboard", description="x", requires_confirm=False),
        )
        await _spin_until(lambda: _result_for(backend, "act_3") is not None,
                          hint="act_3 result")
        r = _result_for(backend, "act_3") or {}
        rc |= _assert(r.get("status") == "failed", "status=failed")
        rc |= _assert(
            r.get("error") == "intentional failure",
            f"error='intentional failure' (got {r.get('error')!r})",
        )

        # ── 시나리오 4: requires_confirm=True + accept → completed ──
        print()
        print("[4] requires_confirm=True + confirm(accept=True) → completed")
        backend.enqueue(
            "act_4",
            ClientAction(type="notify", description="confirm me", requires_confirm=True),
        )
        # client_action.pending이 emit될 때까지 기다림
        await _spin_until(
            lambda: any(
                e.type == "client_action.pending" and e.payload.get("action_id") == "act_4"
                for e in emitted
            ),
            hint="client_action.pending act_4",
        )
        # accept
        ok = dispatcher.confirm("act_4", True)
        rc |= _assert(ok, "dispatcher.confirm returned True")
        await _spin_until(lambda: _result_for(backend, "act_4") is not None,
                          hint="act_4 result")
        r = _result_for(backend, "act_4") or {}
        rc |= _assert(r.get("status") == "completed", f"status=completed (got {r.get('status')})")

        # ── 시나리오 5: requires_confirm=True + reject → rejected ──
        print()
        print("[5] requires_confirm=True + confirm(accept=False) → rejected")
        backend.enqueue(
            "act_5",
            ClientAction(type="notify", description="reject me", requires_confirm=True),
        )
        await _spin_until(
            lambda: any(
                e.type == "client_action.pending" and e.payload.get("action_id") == "act_5"
                for e in emitted
            ),
            hint="client_action.pending act_5",
        )
        dispatcher.confirm("act_5", False)
        await _spin_until(lambda: _result_for(backend, "act_5") is not None,
                          hint="act_5 result")
        r = _result_for(backend, "act_5") or {}
        rc |= _assert(r.get("status") == "rejected", f"status=rejected (got {r.get('status')})")
        rc |= _assert(
            r.get("error") == "user rejected confirmation",
            f"error msg (got {r.get('error')!r})",
        )

        # ── 시나리오 6: confirm timeout → timeout ──
        print()
        print("[6] requires_confirm=True + confirm 안 함 (2s timeout) → timeout")
        backend.enqueue(
            "act_6",
            ClientAction(type="notify", description="ignore me", requires_confirm=True),
        )
        await _spin_until(lambda: _result_for(backend, "act_6") is not None,
                          timeout=4.0, hint="act_6 result (after timeout)")
        r = _result_for(backend, "act_6") or {}
        rc |= _assert(r.get("status") == "timeout", f"status=timeout (got {r.get('status')})")

        # ── 시나리오 7: 같은 action_id 중복 enqueue → 한 번만 처리 ──
        print()
        print("[7] 동일 action_id 중복 → 한 번만 dispatch")
        before = len(backend.results)
        # 같은 act_1을 다시 큐에 넣음 — backend.delivered_ids에 이미 있으므로 전달도 안 되지만
        # poller의 _seen에도 있으므로 안전망 두 겹.
        backend.queue.append(
            {
                "contract_version": "1.0",
                "action_id": "act_1",
                "request_id": "req_test",
                "action": {
                    "type": "notify",
                    "description": "dup",
                    "requires_confirm": False,
                    "args": {},
                },
            }
        )
        backend.delivered_ids.discard("act_1")  # backend는 다시 보내려고 함
        await asyncio.sleep(0.5)
        # poller의 _seen이 있으므로 처리 안 함
        after = len(backend.results)
        rc |= _assert(after == before, f"중복 dispatch 안 됨 (before={before}, after={after})")

        # ── 시나리오 8: 401 → poller 정지 ──
        print()
        print("[8] backend 401 → poller 자동 정지")
        backend.unauthorized = True
        # poller 루프가 한 사이클 더 돌고 401 받고 종료
        await _spin_until(
            lambda: poller._task is not None and poller._task.done(),  # type: ignore[union-attr]
            timeout=3.0,
            hint="poller task done after 401",
        )
        rc |= _assert(
            poller._task is not None and poller._task.done(),  # type: ignore[union-attr]
            "poller task ended on 401",
        )

    finally:
        await poller.stop()
        await runner.cleanup()

    print()
    print("=" * 60)
    if rc == 0:
        print("ALL OK — Phase 1.2 dispatch loop 정상")
    else:
        print("FAILED — 위 출력에서 ✗ 항목 확인")
    print("=" * 60)
    return rc


def main() -> int:
    return asyncio.run(run_scenarios())


if __name__ == "__main__":
    sys.exit(main())
