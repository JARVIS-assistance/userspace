from __future__ import annotations

import asyncio
import os
import logging
import time
import uuid

import httpx
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.actions.api_client import ClientActionAPIClient
from app.actions.poller import ActionPoller
from app.actions.policy import actions_to_dict
from app.actions.registry import ActionRegistry
from app.client_context import build_runtime_headers
from app.config import load_settings, settings as _initial_settings
from app.models.messages import EventEnvelope, StartSessionRequest
from app.os_permissions import MacOSPermissionStatus, request_macos_action_permissions
from app.realtime.client import RealtimeChatClient
from app.realtime.conversation import ConversationManager, ConversationState
from app.realtime.ollama_client import OllamaConfig
from app.stt.session import STTSession
from app.stt.whisper_engine import LocalWhisperEngine
from app.ws_runtime import (
    apply_actions_config_patch,
    build_action_dispatcher,
    forward_conversation_events,
    send_events,
    sync_runtime_profile,
)

logger = logging.getLogger(__name__)
ACTION_STREAM_TIMEOUT_FLOOR_SECONDS = 120.0
macos_permission_status: MacOSPermissionStatus | None = None
ALLOW_WS_ANON = os.getenv("JARVIS_USERSPACE_AUTH_DISABLED", "0").strip().lower() in {"1", "true", "yes", "on"}

# 라이브에서 갱신 가능한 settings (config.json 저장 후 reload 가능).
settings = _initial_settings


def _reload_settings_global():
    """config.json을 다시 읽어 main 모듈의 settings를 교체한다."""
    global settings
    settings = load_settings()
    return settings.actions


def _conversation_timeout_seconds() -> float:
    return max(settings.ollama.timeout, ACTION_STREAM_TIMEOUT_FLOOR_SECONDS)


app = FastAPI(title="JARVIS Userspace", version="0.1.0")
actions = ActionRegistry()
chat = RealtimeChatClient()
default_profile = settings.stt_profiles.get(settings.stt_default_profile)
stt_engine = LocalWhisperEngine(
    model_name=settings.stt_model_name,
    device=settings.stt_device,
    compute_type=settings.stt_compute_type,
    language=settings.stt_language,
    sample_rate=settings.stt_sample_rate,
    realtime_interval_ms=(
        default_profile.partial_interval_ms if default_profile else 300
    ),
    cpu_threads=settings.stt_cpu_threads,
)

ollama_config = OllamaConfig(
    base_url=settings.ollama.base_url,
    timeout=settings.ollama.timeout,
)


@app.on_event("startup")
async def request_startup_os_permissions() -> None:
    global macos_permission_status
    macos_permission_status = await request_macos_action_permissions()
    if macos_permission_status.checked:
        logger.info(
            "macOS action permission probe automation_granted=%s reason=%s",
            macos_permission_status.automation_granted,
            macos_permission_status.reason,
        )

async def _verify_external_token(token: str) -> dict | None:
    """Verify token against the external auth API."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(
                f"{settings.auth_api_base}/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            if res.status_code == 200:
                return res.json()
    except Exception:
        pass
    return None


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "service": "userspace",
            "env": settings.env,
            "macos_permissions": (
                macos_permission_status.model_dump()
                if macos_permission_status is not None
                else None
            ),
        }
    )


@app.post("/session/start")
async def start_session(payload: StartSessionRequest) -> JSONResponse:
    session_id = str(uuid.uuid4())
    return JSONResponse(
        {
            "session_id": session_id,
            "user_id": payload.user_id,
            "metadata": payload.metadata,
        }
    )


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(default="")) -> None:
    user: dict | None = None
    if not ALLOW_WS_ANON:
        user = await _verify_external_token(token) if token else None
        if not user:
            await websocket.close(code=4001, reason="Unauthorized")
            return
    elif not token:
        user = {"user_id": "local"}

    if user is None and not ALLOW_WS_ANON:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    if ALLOW_WS_ANON and not user:
        user = {"user_id": "local"}
    await websocket.accept()
    stt_session = STTSession(
        engine=stt_engine,
        sample_rate=settings.stt_sample_rate,
        default_profile=settings.stt_default_profile,
        profiles=settings.stt_profiles,
        emit_debug_state=settings.stt_emit_debug_state,
    )
    # 이 WS 세션을 식별하는 stable client_id — /conversation/stream과
    # /client/actions/* 양쪽에 동일한 헤더(x-client-id)로 전송한다.
    user_id = (
        user.get("user_id") if isinstance(user, dict) else None
    ) or "anon"
    client_id = f"jarvis-userspace-{user_id}-{uuid.uuid4().hex[:8]}"
    runtime_headers = build_runtime_headers(settings.actions)
    print(f"[WS] client_id={client_id}", flush=True)

    config = OllamaConfig(
        base_url=ollama_config.base_url,
        timeout=_conversation_timeout_seconds(),
        auth_token=token,
        client_id=client_id,
        runtime_headers=runtime_headers,
    )
    conversation = ConversationManager(ollama_config=config)
    send_lock = asyncio.Lock()
    conversation_tasks: set[asyncio.Task[None]] = set()

    async def send_json(data: dict[str, object]) -> None:
        async with send_lock:
            await websocket.send_json(data)

    # ── Action dispatcher / poller (per-WS) ───────────
    action_api = ClientActionAPIClient(
        base_url=ollama_config.base_url,
        auth_token=token,
        timeout=_conversation_timeout_seconds(),
        client_id=client_id,
        runtime_headers=runtime_headers,
    )
    await sync_runtime_profile(action_api, settings.actions)

    async def emit_event(envelope: EventEnvelope) -> None:
        await send_json(envelope.model_dump())

    dispatcher = build_action_dispatcher(settings.actions, emit=emit_event)
    poller = ActionPoller(api=action_api, dispatcher=dispatcher)
    poller.start()

    def _now_ms() -> int:
        return int(time.time() * 1000)

    async def emit_conversation(envelope: EventEnvelope) -> None:
        # Delta events arrive token-by-token and make the dev log noisy.
        # Keep sending them to the UI, but do not print each chunk.
        if envelope.type != "conversation.delta":
            print(f"[CONV] {envelope.type}: {envelope.payload}", flush=True)
        await send_json(envelope.model_dump())

    async def forward_conversation(events) -> None:
        """ConversationManager 이벤트 → WS 송신 + action dispatch."""
        await forward_conversation_events(
            events,
            emit_conversation=emit_conversation,
            poller=poller,
        )

    async def run_conversation(events) -> None:
        try:
            await forward_conversation(events)
        except Exception as exc:
            logger.exception("conversation forwarding failed")
            await send_json(
                EventEnvelope(
                    type="conversation.error",
                    payload={"message": str(exc)},
                ).model_dump()
            )

    def start_conversation(events) -> None:
        task = asyncio.create_task(run_conversation(events))
        conversation_tasks.add(task)
        task.add_done_callback(conversation_tasks.discard)

    async def cancel_pending_conversation() -> None:
        # 선행 대화(실시간 응답/의도 분류/플래닝) 중단 후 새로운 요청만 처리.
        active_tasks = [task for task in list(conversation_tasks) if not task.done()]
        for task in active_tasks:
            task.cancel()
        if active_tasks:
            await asyncio.gather(*active_tasks, return_exceptions=True)

        if conversation.state in (
            ConversationState.PROCESSING,
            ConversationState.SPEAKING,
        ):
            cancel_events = await conversation.cancel()
            for ev in cancel_events:
                print(f"[CONV] {ev.type}: {ev.payload}", flush=True)
                await send_json(ev.model_dump())

    try:
        await send_json(
            EventEnvelope(type="chat.done", payload={"text": ""}).model_dump()
        )

        while True:
            message = await websocket.receive_json()
            event_type = message.get("type")
            payload = message.get("payload", {})

            if event_type == "chat.request":
                text = str(payload.get("text", "")).strip()
                if text:
                    print(f"[CHAT] {text}", flush=True)
                    await cancel_pending_conversation()
                    start_conversation(conversation.handle_stt_final(text))
                continue

            if event_type == "conversation.greeting":
                print("[CONV] initial greeting requested", flush=True)
                if conversation.state == ConversationState.IDLE:
                    start_conversation(conversation.handle_initial_greeting())
                continue

            if event_type == "action.request":
                name = str(payload.get("name", ""))
                args = payload.get("args", {})
                result = await actions.execute(name, args)
                await send_json(result.model_dump())
                continue

            if event_type == "config.actions.get":
                await send_json(
                    EventEnvelope(
                        type="config.actions.value",
                        payload=actions_to_dict(settings.actions),
                    ).model_dump()
                )
                continue

            if event_type == "config.actions.set":
                try:
                    new_actions_payload = await apply_actions_config_patch(
                        config_path=settings.config_path,
                        payload=payload,
                        runtime_headers=runtime_headers,
                        action_api=action_api,
                        dispatcher=dispatcher,
                        reload_settings=_reload_settings_global,
                    )
                except Exception as e:
                    logger.exception("config.actions.set failed")
                    await send_json(
                        EventEnvelope(
                            type="config.actions.error",
                            payload={"message": str(e)},
                        ).model_dump()
                    )
                    continue

                await send_json(
                    EventEnvelope(
                        type="config.actions.value",
                        payload=new_actions_payload,
                    ).model_dump()
                )
                continue

            if event_type == "client_action.confirm":
                action_id = str(payload.get("action_id", ""))
                accepted = bool(payload.get("accepted", False))
                reason = payload.get("reason")
                reason_text = str(reason) if reason is not None else None
                if not action_id:
                    err = EventEnvelope(
                        type="error",
                        payload={"message": "client_action.confirm: missing action_id"},
                    )
                    await send_json(err.model_dump())
                else:
                    found = dispatcher.confirm(action_id, accepted, reason_text)
                    logger.info(
                        "client_action.confirm received action_id=%s accepted=%s found=%s",
                        action_id,
                        accepted,
                        found,
                    )
                    if not found:
                        logger.info(
                            "client_action.confirm: no pending confirm for action_id=%s",
                            action_id,
                        )
                continue

            if event_type == "stt.start":
                events = await stt_session.handle_start(payload)
                await send_events(events, send_json=send_json)
                start_events = await conversation.handle_speech_start()
                await send_events(start_events, send_json=send_json)
                continue

            if event_type == "stt.audio.chunk":
                events = await stt_session.handle_audio_chunk(payload)
                for event in events:
                    await send_json(event.model_dump())

                    if event.type == "stt.partial":
                        text = str(event.payload.get("text", ""))
                        if text:
                            conv_events = await conversation.handle_stt_partial(text)
                            for ce in conv_events:
                                await send_json(ce.model_dump())

                    elif event.type == "stt.final":
                        text = str(event.payload.get("text", ""))
                        print(f"[STT FINAL] {text}", flush=True)
                        if text:
                            await cancel_pending_conversation()
                            start_conversation(conversation.handle_stt_final(text))
                continue

            if event_type == "stt.stop":
                events = await stt_session.handle_stop()
                for event in events:
                    await send_json(event.model_dump())

                    if event.type == "stt.final":
                        text = str(event.payload.get("text", ""))
                        print(f"[STT FINAL on stop] {text}", flush=True)
                        if text:
                            await cancel_pending_conversation()
                            start_conversation(conversation.handle_stt_final(text))
                continue

            if event_type == "conversation.reset":
                reset_event = conversation.reset()
                await send_json(reset_event.model_dump())
                continue

            if event_type == "conversation.cancel":
                cancel_events = await conversation.cancel()
                for ev in cancel_events:
                    print(f"[CONV] {ev.type}: {ev.payload}", flush=True)
                    await send_json(ev.model_dump())
                continue

            error = EventEnvelope(
                type="error",
                payload={"message": f"Unsupported event type: {event_type}"},
            )
            await send_json(error.model_dump())

    except WebSocketDisconnect:
        pass
    finally:
        for task in list(conversation_tasks):
            task.cancel()
        if conversation_tasks:
            await asyncio.gather(*conversation_tasks, return_exceptions=True)
        dispatcher.cancel_all_pending_confirms()
        await poller.stop()
        await conversation.close()
