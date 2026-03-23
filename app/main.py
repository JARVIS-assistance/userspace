from __future__ import annotations

import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

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
    realtime_interval_ms=default_profile.partial_interval_ms if default_profile else 300,
    cpu_threads=settings.stt_cpu_threads,
)

ollama_config = OllamaConfig(
    base_url=settings.ollama.base_url,
    model=settings.ollama.model,
    timeout=settings.ollama.timeout,
    temperature=settings.ollama.temperature,
    top_p=settings.ollama.top_p,
    max_tokens=settings.ollama.max_tokens,
    system_prompt=settings.ollama.system_prompt,
)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "service": "userspace",
            "env": settings.env,
        }
    )


@app.get("/stt-test")
async def stt_test_page() -> HTMLResponse:
    return HTMLResponse(
        """
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JARVIS Voice (Barge-in)</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { color: #4fc3f7; margin-bottom: 5px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 20px; }
    button { padding: 12px 24px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; margin-right: 10px; }
    .start { background: #4caf50; color: white; }
    .stop { background: #f44336; color: white; }
    .box { background: #2a2a4a; border-radius: 8px; padding: 16px; margin-top: 16px; min-height: 60px; }
    .label { color: #888; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; }
    .partial { color: #888; font-style: italic; }
    .user-text { color: #4fc3f7; }
    .assistant-text { color: #a78bfa; white-space: pre-wrap; }
    .state-bar { display: flex; gap: 8px; margin: 16px 0; }
    .state { padding: 4px 12px; border-radius: 12px; font-size: 12px; background: #333; color: #666; }
    .state.active { background: #4fc3f7; color: #000; }
    .state.barge-in { background: #f44336; color: #fff; animation: pulse 0.3s infinite; }
    @keyframes pulse { 50% { opacity: 0.5; } }
    #status { margin-top: 16px; color: #888; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>JARVIS Voice</h1>
    <p class="subtitle">Barge-in: Speak while AI is responding to interrupt</p>
    
    <button id="startBtn" class="start">Start</button>
    <button id="stopBtn" class="stop" disabled>Stop</button>
    
    <div class="state-bar">
      <span class="state" id="stateIdle">IDLE</span>
      <span class="state" id="stateListening">LISTENING</span>
      <span class="state" id="stateProcessing">PROCESSING</span>
      <span class="state" id="stateSpeaking">SPEAKING</span>
    </div>
    
    <div class="box">
      <div class="label">You (STT)</div>
      <div id="partial" class="partial"></div>
      <div id="userText" class="user-text"></div>
    </div>
    
    <div class="box">
      <div class="label">JARVIS (LLM)</div>
      <div id="assistantText" class="assistant-text"></div>
    </div>
    
    <div id="status">Ready</div>
  </div>
  
  <script>
    const partialEl = document.getElementById("partial");
    const userTextEl = document.getElementById("userText");
    const assistantTextEl = document.getElementById("assistantText");
    const statusEl = document.getElementById("status");
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const states = { idle: document.getElementById("stateIdle"), listening: document.getElementById("stateListening"), processing: document.getElementById("stateProcessing"), speaking: document.getElementById("stateSpeaking") };
    
    let ws, mediaStream, audioContext, source, processor, muteGain, flushTimer;
    let pcmQueue = [];
    
    function setState(s) {
      Object.values(states).forEach(el => el.classList.remove("active", "barge-in"));
      if (states[s]) states[s].classList.add("active");
    }
    
    function payloadField(msg, key, fallback) {
      if (!msg || typeof msg !== "object") return fallback;
      const payload = msg.payload;
      if (!payload || typeof payload !== "object") return fallback;
      const value = payload[key];
      return value === undefined || value === null ? fallback : value;
    }

    function toInt16Array(f32) {
      const out = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i += 1) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      }
      return out;
    }

    function int16ToBase64(samples) {
      const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
    }

    function flushQueuedAudio() {
      if (!ws || ws.readyState !== 1) {
        pcmQueue = [];
        return;
      }
      if (pcmQueue.length === 0) {
        return;
      }
      let total = 0;
      for (let i = 0; i < pcmQueue.length; i += 1) {
        total += pcmQueue[i].length;
      }
      const merged = new Int16Array(total);
      let offset = 0;
      for (let i = 0; i < pcmQueue.length; i += 1) {
        merged.set(pcmQueue[i], offset);
        offset += pcmQueue[i].length;
      }
      pcmQueue = [];

      ws.send(JSON.stringify({
        type: "stt.audio.chunk",
        payload: {
          audio_b64: int16ToBase64(merged),
          sample_rate: audioContext ? audioContext.sampleRate : 16000
        }
      }));
    }

    async function start() {
      statusEl.textContent = "Requesting mic...";
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusEl.textContent = "This browser does not support microphone access.";
        return;
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      ws = new WebSocket("ws://" + location.host + "/ws");
      
      ws.onopen = () => {
        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        muteGain = audioContext.createGain();
        muteGain.gain.value = 0.0;
        
        ws.send(JSON.stringify({ type: "stt.start", payload: { sample_rate: audioContext.sampleRate } }));
        
        processor.onaudioprocess = (e) => {
          if (ws.readyState === 1) {
            pcmQueue.push(toInt16Array(e.inputBuffer.getChannelData(0)));
          }
        };
        
        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(audioContext.destination);
        flushTimer = setInterval(flushQueuedAudio, 120);
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusEl.textContent = "Listening... Speak now!";
        setState("listening");
      };
      
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        
        if (msg.type === "stt.partial") {
          partialEl.textContent = String(payloadField(msg, "text", ""));
        }
        if (msg.type === "stt.final") {
          userTextEl.textContent = String(payloadField(msg, "text", ""));
          partialEl.textContent = "";
        }
        if (msg.type === "conversation.state") {
          const state = String(payloadField(msg, "state", "idle"));
          setState(state);
          statusEl.textContent = "State: " + state;
        }
        if (msg.type === "conversation.delta") {
          assistantTextEl.textContent += String(payloadField(msg, "text", ""));
        }
        if (msg.type === "conversation.done") {
          assistantTextEl.textContent = String(payloadField(msg, "text", ""));
          statusEl.textContent = "Response complete";
        }
        if (msg.type === "conversation.barge_in") {
          states.listening.classList.add("barge-in");
          setTimeout(() => states.listening.classList.remove("barge-in"), 1000);
          assistantTextEl.textContent += " [interrupted]";
          statusEl.textContent = "Barge-in! Listening...";
        }
        if (msg.type === "error") {
          statusEl.textContent = "Error: " + String(payloadField(msg, "message", "unknown"));
        }
      };
      
      ws.onclose = () => { statusEl.textContent = "Disconnected"; setState("idle"); };
    }
    
    async function stop() {
      if (ws && ws.readyState === 1) {
        flushQueuedAudio();
        ws.send(JSON.stringify({ type: "stt.stop", payload: {} }));
      }
      if (flushTimer) clearInterval(flushTimer);
      if (processor) processor.disconnect();
      if (muteGain) muteGain.disconnect();
      if (source) source.disconnect();
      if (audioContext) await audioContext.close();
      if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
      if (ws) ws.close();
      ws = mediaStream = audioContext = source = processor = muteGain = flushTimer = null;
      pcmQueue = [];
      startBtn.disabled = false;
      stopBtn.disabled = true;
      statusEl.textContent = "Stopped";
      setState("idle");
    }
    
    startBtn.onclick = start;
    stopBtn.onclick = stop;
  </script>
</body>
</html>
        """
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
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    stt_session = STTSession(
        engine=stt_engine,
        sample_rate=settings.stt_sample_rate,
        default_profile=settings.stt_default_profile,
        profiles=settings.stt_profiles,
        emit_debug_state=settings.stt_emit_debug_state,
    )
    conversation = ConversationManager(ollama_config=ollama_config)
    
    try:
        await websocket.send_json(
            EventEnvelope(type="chat.done", payload={"text": "userspace connected"}).model_dump()
        )

        while True:
            message = await websocket.receive_json()
            event_type = message.get("type")
            payload = message.get("payload", {})

            if event_type == "chat.request":
                text = str(payload.get("text", "")).strip()
                async for event in chat.stream_reply(text):
                    await websocket.send_json(event.model_dump())
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
