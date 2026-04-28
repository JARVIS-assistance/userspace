from __future__ import annotations

import logging
import uuid

import httpx

logger = logging.getLogger(__name__)
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.actions.registry import ActionRegistry
from app.config import settings
from app.models.messages import EventEnvelope, StartSessionRequest
from app.realtime.client import RealtimeChatClient
from app.realtime.conversation import ConversationManager
from app.realtime.ollama_client import OllamaConfig
from app.stt.engine import LocalWhisperEngine
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
    config = OllamaConfig(
        base_url=ollama_config.base_url,
        timeout=ollama_config.timeout,
        auth_token=token,
    )
    conversation = ConversationManager(ollama_config=config)

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
                    async for ce in conversation.handle_stt_final(text):
                        print(f"[CONV] {ce.type}: {ce.payload}", flush=True)
                        await websocket.send_json(ce.model_dump())
                continue

            if event_type == "action.request":
                name = str(payload.get("name", ""))
                args = payload.get("args", {})
                result = await actions.execute(name, args)
                await websocket.send_json(result.model_dump())
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
                            async for ce in conversation.handle_stt_final(text):
                                print(f"[CONV] {ce.type}: {ce.payload}", flush=True)
                                await websocket.send_json(ce.model_dump())
                continue

            if event_type == "stt.stop":
                events = await stt_session.handle_stop()
                for event in events:
                    await websocket.send_json(event.model_dump())

                    if event.type == "stt.final":
                        text = str(event.payload.get("text", ""))
                        print(f"[STT FINAL on stop] {text}", flush=True)
                        if text:
                            async for ce in conversation.handle_stt_final(text):
                                print(f"[CONV] {ce.type}: {ce.payload}", flush=True)
                                await websocket.send_json(ce.model_dump())
                continue

            if event_type == "conversation.reset":
                reset_event = conversation.reset()
                await websocket.send_json(reset_event.model_dump())
                continue

            error = EventEnvelope(
                type="error",
                payload={"message": f"Unsupported event type: {event_type}"},
            )
            await websocket.send_json(error.model_dump())

    except WebSocketDisconnect:
        await conversation.close()
