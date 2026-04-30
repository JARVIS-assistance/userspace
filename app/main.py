from __future__ import annotations

import logging
import time
import uuid

import httpx

logger = logging.getLogger(__name__)
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.actions.api_client import ClientActionAPIClient
from app.actions.dispatcher import ActionDispatcher
from app.actions.models import PendingClientAction
from app.actions.poller import ActionPoller
from app.actions.policy import actions_to_dict, persist_actions_patch
from app.actions.registry import ActionRegistry
from app.actions.setup import register_default_handlers
from app.client_context import build_runtime_headers
from app.config import load_settings, settings as _initial_settings

# 라이브에서 갱신 가능한 settings (config.json 저장 후 reload 가능).
settings = _initial_settings


def _reload_settings_global() -> None:
    """config.json을 다시 읽어 main 모듈의 settings를 교체한다."""
    global settings
    settings = load_settings()
from app.models.messages import EventEnvelope, StartSessionRequest
from app.realtime.client import RealtimeChatClient
from app.realtime.conversation import ConversationManager
from app.realtime.ollama_client import OllamaConfig
from app.stt.whisper_engine import LocalWhisperEngine
from app.stt.session import STTSession

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
    user = await _verify_external_token(token) if token else None
    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return
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
        timeout=ollama_config.timeout,
        auth_token=token,
        client_id=client_id,
        runtime_headers=runtime_headers,
    )
    conversation = ConversationManager(ollama_config=config)

    # ── Action dispatcher / poller (per-WS) ───────────
    action_api = ClientActionAPIClient(
        base_url=ollama_config.base_url,
        auth_token=token,
        timeout=ollama_config.timeout,
        client_id=client_id,
        runtime_headers=runtime_headers,
    )

    async def emit_event(envelope: EventEnvelope) -> None:
        await websocket.send_json(envelope.model_dump())

    enabled_set = set(settings.actions.enabled_types)
    dispatcher = ActionDispatcher(
        emit=emit_event,
        # None이면 dispatcher가 전부 허용. 빈 tuple은 "전혀 허용 안 함"이라 None과 구분.
        enabled_types=(enabled_set if settings.actions.enabled_types else None),
        # enabled 안에 들어있는 type만 force-confirm 의미가 있음.
        force_confirm_types=enabled_set & set(settings.actions.force_confirm_types),
    )
    register_default_handlers(dispatcher, settings.actions)
    poller = ActionPoller(api=action_api, dispatcher=dispatcher)

    def _now_ms() -> int:
        return int(time.time() * 1000)

    async def emit_conversation(envelope: EventEnvelope) -> None:
        # Delta events arrive token-by-token and make the dev log noisy.
        # Keep sending them to the UI, but do not print each chunk.
        if envelope.type != "conversation.delta":
            print(f"[CONV] {envelope.type}: {envelope.payload}", flush=True)
        await websocket.send_json(envelope.model_dump())

    async def forward_conversation(events) -> None:
        """ConversationManager 이벤트 → WS 송신 + action dispatch."""
        async for ce in events:
            if ce.type == "conversation.action_dispatch":
                try:
                    pending = PendingClientAction.model_validate(ce.payload)
                except Exception as e:
                    await emit_conversation(ce)
                    logger.warning("invalid action_dispatch payload: %s", e)
                    poller.start()
                    poller.wake()
                else:
                    await emit_conversation(ce)
                    await poller.dispatch_pending_now(pending)
                continue

            await emit_conversation(ce)

    try:
        await websocket.send_json(
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
                    await forward_conversation(conversation.handle_stt_final(text))
                continue

            if event_type == "action.request":
                name = str(payload.get("name", ""))
                args = payload.get("args", {})
                result = await actions.execute(name, args)
                await websocket.send_json(result.model_dump())
                continue

            if event_type == "config.actions.get":
                await websocket.send_json(
                    EventEnvelope(
                        type="config.actions.value",
                        payload=actions_to_dict(settings.actions),
                    ).model_dump()
                )
                continue

            if event_type == "config.actions.set":
                try:
                    new_actions = persist_actions_patch(
                        settings.config_path, payload
                    )
                except Exception as e:
                    logger.exception("config.actions.set failed")
                    await websocket.send_json(
                        EventEnvelope(
                            type="config.actions.error",
                            payload={"message": str(e)},
                        ).model_dump()
                    )
                    continue

                # main 모듈의 settings 갱신 + dispatcher hot-apply.
                _reload_settings_global()
                runtime_headers.clear()
                runtime_headers.update(build_runtime_headers(settings.actions))
                new_enabled = set(settings.actions.enabled_types)
                dispatcher.set_policy(
                    enabled_types=(new_enabled if settings.actions.enabled_types else None),
                    force_confirm_types=new_enabled
                    & set(settings.actions.force_confirm_types),
                )
                dispatcher.clear_handlers()
                register_default_handlers(dispatcher, settings.actions)
                print(
                    f"[CFG] actions updated  enabled={sorted(new_enabled)}  "
                    f"force_confirm={sorted(settings.actions.force_confirm_types)}",
                    flush=True,
                )
                await websocket.send_json(
                    EventEnvelope(
                        type="config.actions.value",
                        payload=actions_to_dict(new_actions),
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
                    await websocket.send_json(err.model_dump())
                else:
                    found = dispatcher.confirm(action_id, accepted, reason_text)
                    if not found:
                        logger.info(
                            "client_action.confirm: no pending confirm for action_id=%s",
                            action_id,
                        )
                continue

            if event_type == "stt.start":
                events = await stt_session.handle_start(payload)
                for event in events:
                    await websocket.send_json(event.model_dump())
                start_events = await conversation.handle_speech_start()
                for event in start_events:
                    await websocket.send_json(event.model_dump())
                continue

            if event_type == "stt.audio.chunk":
                events = await stt_session.handle_audio_chunk(payload)
                for event in events:
                    await websocket.send_json(event.model_dump())

                    if event.type == "stt.partial":
                        text = str(event.payload.get("text", ""))
                        if text:
                            conv_events = await conversation.handle_stt_partial(text)
                            for ce in conv_events:
                                await websocket.send_json(ce.model_dump())

                    elif event.type == "stt.final":
                        text = str(event.payload.get("text", ""))
                        print(f"[STT FINAL] {text}", flush=True)
                        if text:
                            await forward_conversation(
                                conversation.handle_stt_final(text)
                            )
                continue

            if event_type == "stt.stop":
                events = await stt_session.handle_stop()
                for event in events:
                    await websocket.send_json(event.model_dump())

                    if event.type == "stt.final":
                        text = str(event.payload.get("text", ""))
                        print(f"[STT FINAL on stop] {text}", flush=True)
                        if text:
                            await forward_conversation(
                                conversation.handle_stt_final(text)
                            )
                continue

            if event_type == "conversation.reset":
                reset_event = conversation.reset()
                await websocket.send_json(reset_event.model_dump())
                continue

            if event_type == "conversation.cancel":
                cancel_events = await conversation.cancel()
                for ev in cancel_events:
                    print(f"[CONV] {ev.type}: {ev.payload}", flush=True)
                    await websocket.send_json(ev.model_dump())
                continue

            error = EventEnvelope(
                type="error",
                payload={"message": f"Unsupported event type: {event_type}"},
            )
            await websocket.send_json(error.model_dump())

    except WebSocketDisconnect:
        pass
    finally:
        dispatcher.cancel_all_pending_confirms()
        await poller.stop()
        await conversation.close()
