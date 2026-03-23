import io
import json
import os
import wave
import math
from typing import Optional

import numpy as np
from numpy.typing import NDArray
from scipy.signal import resample_poly
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..core import RealTimePartialSTT, STTEngine


DEFAULT_MODEL_PATH = os.getenv("STT_MODEL_PATH", "models/vosk-model-small-ko-0.22")
DEFAULT_BACKEND = os.getenv("STT_BACKEND", "vosk")
DEFAULT_WHISPER_MODEL = os.getenv("STT_WHISPER_MODEL", "small")
DEFAULT_WHISPER_DEVICE = os.getenv("STT_WHISPER_DEVICE", "auto")
DEFAULT_WHISPER_COMPUTE_TYPE = os.getenv("STT_WHISPER_COMPUTE_TYPE", "int8")
DEFAULT_WHISPER_CPU_THREADS = int(os.getenv("STT_WHISPER_CPU_THREADS", "2"))
DEFAULT_WHISPER_RT_INTERVAL_SEC = float(os.getenv("STT_WHISPER_RT_INTERVAL_SEC", "0.8"))
DEFAULT_WHISPER_MAX_WINDOW_SEC = float(os.getenv("STT_WHISPER_MAX_WINDOW_SEC", "4.0"))

app = FastAPI(title="STT Service", version="2.0.0")
stt_engine = STTEngine(
    sample_rate=16000,
    model_path=DEFAULT_MODEL_PATH,
    backend=DEFAULT_BACKEND,
    whisper_model_size=DEFAULT_WHISPER_MODEL,
    whisper_device=DEFAULT_WHISPER_DEVICE,
    whisper_compute_type=DEFAULT_WHISPER_COMPUTE_TYPE,
    whisper_cpu_threads=DEFAULT_WHISPER_CPU_THREADS,
    whisper_realtime_interval_sec=DEFAULT_WHISPER_RT_INTERVAL_SEC,
    whisper_max_window_sec=DEFAULT_WHISPER_MAX_WINDOW_SEC,
)


class TranscriptionResponse(BaseModel):
    text: str
    confidence: Optional[float] = None
    duration_sec: float
    mfcc_dim: int


def wav_bytes_to_float32(audio_bytes: bytes) -> tuple[NDArray[np.float32], int]:
    with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if channels != 1:
        raise ValueError("Only mono WAV is supported.")
    if sample_width != 2:
        raise ValueError("Only 16-bit PCM WAV is supported.")

    pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
    return pcm / 32768.0, sample_rate


def resample_to_target_rate(audio: NDArray[np.float32], source_rate: int, target_rate: int) -> NDArray[np.float32]:
    if source_rate == target_rate:
        return audio
    if source_rate <= 0:
        raise ValueError("Invalid source sample rate")
    factor = math.gcd(source_rate, target_rate)
    up = target_rate // factor
    down = source_rate // factor
    resampled = resample_poly(audio, up, down)
    return np.asarray(resampled, dtype=np.float32)


@app.get("/")
async def root() -> HTMLResponse:
    return HTMLResponse(
        """
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Real-time STT</title>
  <style>
    body { font-family: "Noto Sans KR", sans-serif; max-width: 860px; margin: 30px auto; padding: 0 16px; background: #f4f6f8; color: #1f2937; }
    .card { background: #ffffff; border-radius: 14px; padding: 18px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 14px; }
    button { border: none; border-radius: 10px; padding: 10px 16px; font-size: 15px; cursor: pointer; margin-right: 8px; }
    .start { background: #0f766e; color: #fff; }
    .stop { background: #b91c1c; color: #fff; }
    .reset { background: #334155; color: #fff; }
    .label { margin-top: 14px; font-weight: 700; }
    .box { margin-top: 8px; min-height: 64px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; white-space: pre-wrap; }
    .hint { color: #475569; font-size: 13px; margin-top: 10px; }
    .status { margin-top: 10px; color: #0f766e; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>실시간 STT</h1>
    <p>말하는 동안 부분 전사(partial)가 갱신되고, 문장이 확정되면 final로 누적됩니다.</p>
    <button type="button" id="startBtn" class="start">녹음 시작</button>
    <button type="button" id="stopBtn" class="stop" disabled>녹음 종료</button>
    <button type="button" id="resetBtn" class="reset">초기화</button>
    <div id="status" class="status">대기 중</div>

    <div class="label">Partial (실시간 중간 결과)</div>
    <div id="partial" class="box"></div>

    <div class="label">Final (확정 결과 누적)</div>
    <div id="final" class="box"></div>

    <div class="hint">브라우저 원본 샘플레이트로 전송하고 서버에서 16kHz로 리샘플링합니다.</div>
  </div>

  <script>
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const resetBtn = document.getElementById("resetBtn");
    const statusEl = document.getElementById("status");
    const partialEl = document.getElementById("partial");
    const finalEl = document.getElementById("final");

    let ws = null;
    let audioContext = null;
    let processor = null;
    let source = null;
    let mediaStream = null;
    let currentSessionId = 0;

    async function startRecording() {
      currentSessionId += 1;
      const sessionId = currentSessionId;
      statusEl.textContent = "시작 버튼 클릭됨";
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusEl.textContent = "이 브라우저는 마이크 입력을 지원하지 않습니다.";
        return;
      }

      try {
        statusEl.textContent = "마이크 권한 요청 중...";
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = wsProtocol + "://" + location.host + "/ws/realtime";
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
        if (sessionId !== currentSessionId) {
          return;
        }
        const msg = JSON.parse(event.data);
        if (msg.session_id !== undefined && msg.session_id !== sessionId) {
          return;
        }
        if (msg.partial !== undefined) {
          partialEl.textContent = msg.partial;
        }
        if (msg.final) {
          const prev = finalEl.textContent ? finalEl.textContent + "\\n" : "";
          finalEl.textContent = prev + msg.final;
          partialEl.textContent = "";
        }
        };

        ws.onopen = () => {
          source.connect(processor);
          processor.connect(audioContext.destination);

          processor.onaudioprocess = (event) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const input = event.inputBuffer.getChannelData(0);
            ws.send(JSON.stringify({
              audio: Array.from(input),
              sample_rate: audioContext.sampleRate,
              session_id: sessionId
            }));
          };

          statusEl.textContent = "녹음 중...";
          startBtn.disabled = true;
          stopBtn.disabled = false;
        };

        ws.onerror = () => {
          statusEl.textContent = "WebSocket 연결 오류";
        };

        ws.onclose = () => {
          if (!startBtn.disabled) return;
          statusEl.textContent = "연결 종료";
          startBtn.disabled = false;
          stopBtn.disabled = true;
        };
      } catch (error) {
        const errorText = error && error.message ? error.message : String(error);
        statusEl.textContent = "시작 실패: " + errorText;
      }
    }

    async function stopRecording(finalize = true) {
      if (processor) {
        processor.onaudioprocess = null;
        processor.disconnect();
      }
      if (source) source.disconnect();
      if (audioContext) await audioContext.close();
      if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
      if (finalize && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ eof: true, session_id: currentSessionId }));
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, finalize ? "stop" : "reset");
      }
      ws = null;
      processor = null;
      source = null;
      audioContext = null;
      mediaStream = null;
      statusEl.textContent = "중지됨";
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }

    async function resetTranscription() {
      currentSessionId += 1;
      await stopRecording(false);
      partialEl.textContent = "";
      finalEl.textContent = "";
      statusEl.textContent = "초기화됨";
    }

    window.startRecording = startRecording;
    window.stopRecording = stopRecording;
    window.resetTranscription = resetTranscription;

    startBtn.addEventListener("click", startRecording);
    stopBtn.addEventListener("click", stopRecording);
    resetBtn.addEventListener("click", resetTranscription);
  </script>
</body>
</html>
        """
    )


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(file: UploadFile = File(...)) -> TranscriptionResponse:
    audio_data = await file.read()

    try:
        audio, sample_rate = wav_bytes_to_float32(audio_data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if sample_rate != stt_engine.sample_rate:
        audio = resample_to_target_rate(audio, sample_rate, stt_engine.sample_rate)

    try:
        result = stt_engine.transcribe(audio)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return TranscriptionResponse(
        text=result.text,
        confidence=result.confidence,
        duration_sec=result.duration_sec,
        mfcc_dim=result.mfcc_dim,
    )


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "backend": DEFAULT_BACKEND,
        "model_path": DEFAULT_MODEL_PATH,
        "whisper_model": DEFAULT_WHISPER_MODEL,
        "whisper_device": DEFAULT_WHISPER_DEVICE,
        "whisper_compute_type": DEFAULT_WHISPER_COMPUTE_TYPE,
        "whisper_cpu_threads": str(DEFAULT_WHISPER_CPU_THREADS),
        "whisper_rt_interval_sec": str(DEFAULT_WHISPER_RT_INTERVAL_SEC),
        "whisper_max_window_sec": str(DEFAULT_WHISPER_MAX_WINDOW_SEC),
    }


@app.websocket("/ws/realtime")
async def websocket_realtime_stt(websocket: WebSocket) -> None:
    await websocket.accept()
    realtime = RealTimePartialSTT(stt_engine=stt_engine)
    client_sample_rate = stt_engine.sample_rate
    session_id = 0

    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)

            if payload.get("reset") is True:
                realtime.reset()
                await websocket.close(code=1000, reason="client reset")
                return

            if payload.get("eof") is True:
                payload_session_id = payload.get("session_id")
                if isinstance(payload_session_id, int):
                    session_id = payload_session_id
                flushed = realtime.flush()
                if flushed.text:
                    await websocket.send_json({
                        "session_id": session_id,
                        "final": flushed.text,
                        "is_final": True,
                        "confidence": flushed.confidence,
                        "mfcc_dim": flushed.mfcc_dim,
                    })
                realtime.reset()
                continue

            audio_values = payload.get("audio")
            if not isinstance(audio_values, list):
                await websocket.send_json({"error": "audio must be a list of float values"})
                continue

            payload_rate = payload.get("sample_rate")
            if isinstance(payload_rate, (int, float)) and int(payload_rate) > 0:
                client_sample_rate = int(payload_rate)
            payload_session_id = payload.get("session_id")
            if isinstance(payload_session_id, int):
                session_id = payload_session_id

            chunk = np.asarray(audio_values, dtype=np.float32)
            if client_sample_rate != stt_engine.sample_rate:
                chunk = resample_to_target_rate(chunk, client_sample_rate, stt_engine.sample_rate)
            result = realtime.add_audio_chunk(chunk)
            if result.is_final:
                if result.text:
                    await websocket.send_json({
                        "session_id": session_id,
                        "final": result.text,
                        "is_final": True,
                        "confidence": result.confidence,
                        "mfcc_dim": result.mfcc_dim,
                    })
            else:
                await websocket.send_json({
                    "session_id": session_id,
                    "partial": result.text,
                    "is_final": False,
                    "mfcc_dim": result.mfcc_dim,
                })
    except WebSocketDisconnect:
        return
