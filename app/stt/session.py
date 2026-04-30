from __future__ import annotations

import asyncio
import base64
import math
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.signal import resample_poly

from app.models.messages import EventEnvelope
from app.stt.engine import STTEngineUnavailableError
from app.stt.realtime import RealTimePartialSTT
from app.stt.whisper_engine import LocalWhisperEngine


SILENCE_THRESHOLD_RMS = 0.01
SILENCE_DURATION_MS = 1500
MIN_FINALIZE_SILENCE_MS = 450


@dataclass
class _CompatStreamingResult:
    text: str
    is_final: bool
    confidence: float | None
    mfcc_dim: int


class _CompatRealtime:
    def __init__(self, engine: Any, sample_rate: int) -> None:
        self.engine = engine
        self.sample_rate = sample_rate
        self._pcm_chunks: list[bytes] = []

    @property
    def stt_engine(self) -> Any:
        class _EngineLike:
            def __init__(self, sample_rate: int) -> None:
                self.sample_rate = sample_rate

        return _EngineLike(self.sample_rate)

    def add_audio_chunk(self, chunk: np.ndarray) -> _CompatStreamingResult:
        pcm16 = np.clip(chunk, -1.0, 1.0)
        pcm16 = (pcm16 * 32767.0).astype(np.int16).tobytes()
        self._pcm_chunks.append(pcm16)
        return _CompatStreamingResult(text="", is_final=False, confidence=None, mfcc_dim=0)

    def flush(self) -> _CompatStreamingResult:
        if not self._pcm_chunks:
            return _CompatStreamingResult(text="", is_final=True, confidence=None, mfcc_dim=0)
        pcm16 = b"".join(self._pcm_chunks)
        self._pcm_chunks = []
        result = self.engine.transcribe_pcm16_sync(pcm16, self.sample_rate)
        return _CompatStreamingResult(text=result.text, is_final=True, confidence=None, mfcc_dim=0)

    def reset(self) -> None:
        self._pcm_chunks = []


class STTSession:
    """Per-connection STT session with auto-endpoint on silence."""

    def __init__(
        self,
        *,
        engine: LocalWhisperEngine,
        sample_rate: int,
        default_profile: str,
        profiles: dict[str, Any],
        emit_debug_state: bool,
        silence_duration_ms: int = SILENCE_DURATION_MS,
    ) -> None:
        self.engine = engine
        self.default_sample_rate = sample_rate
        self.default_profile = default_profile
        self.profiles = profiles
        self.emit_debug_state = emit_debug_state
        self.silence_duration_ms = silence_duration_ms

        self.active = False
        self.client_sample_rate = sample_rate
        self._realtime: RealTimePartialSTT | _CompatRealtime | None = None
        
        self._last_speech_time: float = 0.0
        self._speech_start_time: float = 0.0
        self._has_speech: bool = False
        self._last_partial_text: str = ""
        self._active_profile: Any | None = None

    async def handle_start(self, payload: dict[str, Any]) -> list[EventEnvelope]:
        requested_profile = str(payload.get("profile", self.default_profile))
        if self.profiles and requested_profile not in self.profiles:
            names = ", ".join(sorted(self.profiles.keys()))
            return [
                EventEnvelope(
                    type="error",
                    payload={
                        "message": f"Unknown STT profile: {requested_profile}. available=[{names}]",
                    },
                )
            ]

        self.client_sample_rate = int(payload.get("sample_rate", self.default_sample_rate))
        active_profile = self.profiles.get(requested_profile)
        self._active_profile = active_profile

        try:
            await asyncio.to_thread(self.engine.ensure_loaded_sync)
            if hasattr(self.engine, "create_runtime"):
                self._realtime = await asyncio.to_thread(self.engine.create_runtime)
            else:
                self._realtime = _CompatRealtime(self.engine, self.client_sample_rate)
        except STTEngineUnavailableError as exc:
            self.active = False
            return [EventEnvelope(type="error", payload={"message": str(exc)})]

        self.active = True
        self._last_speech_time = time.time()
        self._speech_start_time = 0.0
        self._has_speech = False
        self._last_partial_text = ""
        return [
            EventEnvelope(
                type="stt.state",
                payload={
                    "status": "listening",
                    "profile": requested_profile,
                    "sample_rate": self.client_sample_rate,
                    "frame_ms": int(getattr(active_profile, "frame_ms", 20)),
                },
            )
        ]

    async def handle_audio_chunk(self, payload: dict[str, Any]) -> list[EventEnvelope]:
        if not self.active or self._realtime is None:
            return [EventEnvelope(type="error", payload={"message": "STT is not started. Send stt.start first."})]

        payload_sample_rate = payload.get("sample_rate")
        if isinstance(payload_sample_rate, (int, float)) and int(payload_sample_rate) > 0:
            self.client_sample_rate = int(payload_sample_rate)

        chunk = self._decode_chunk_to_float32(payload)
        if chunk.size == 0:
            return []

        rms = float(np.sqrt(np.mean(chunk ** 2)))
        now = time.time()
        
        if rms > SILENCE_THRESHOLD_RMS:
            if not self._has_speech:
                self._speech_start_time = now
            self._last_speech_time = now
            self._has_speech = True

        runtime_rate = self._realtime.stt_engine.sample_rate
        if self.client_sample_rate != runtime_rate:
            chunk = self._resample_to_target_rate(chunk, self.client_sample_rate, runtime_rate)

        result = await asyncio.to_thread(self._realtime.add_audio_chunk, chunk)
        events: list[EventEnvelope] = []
        
        text_changed = bool(result.text) and result.text != self._last_partial_text
        if result.text:
            self._last_partial_text = result.text

        silence_ms = (now - self._last_speech_time) * 1000
        speech_ms = (self._last_speech_time - self._speech_start_time) * 1000
        endpoint_silence_ms = self._endpoint_silence_ms()
        should_finalize = (
            self._has_speech 
            and speech_ms >= self._minimum_speech_ms()
            and silence_ms >= endpoint_silence_ms
        )
        
        if should_finalize:
            flushed = await asyncio.to_thread(self._realtime.flush)
            if flushed.text:
                events.append(
                    EventEnvelope(
                        type="stt.final",
                        payload={
                            "text": flushed.text,
                            "confidence": flushed.confidence,
                            "mfcc_dim": flushed.mfcc_dim,
                        },
                    )
                )
            self._realtime.reset()
            self._has_speech = False
            self._speech_start_time = 0.0
            self._last_partial_text = ""
        elif result.is_final:
            if result.text:
                events.append(
                    EventEnvelope(
                        type="stt.final",
                        payload={
                            "text": result.text,
                            "confidence": result.confidence,
                            "mfcc_dim": result.mfcc_dim,
                        },
                    )
                )
        elif text_changed:
            events.append(
                EventEnvelope(
                    type="stt.partial",
                    payload={
                        "text": result.text,
                        "confidence": result.confidence,
                        "mfcc_dim": result.mfcc_dim,
                    },
                )
            )

        if self.emit_debug_state:
            events.append(
                EventEnvelope(
                    type="stt.state",
                    payload={
                        "status": "frame",
                        "client_sample_rate": self.client_sample_rate,
                        "engine_sample_rate": runtime_rate,
                    },
                )
            )
        return events

    async def handle_stop(self) -> list[EventEnvelope]:
        if not self.active:
            return [EventEnvelope(type="stt.state", payload={"status": "stopped"})]

        events: list[EventEnvelope] = []
        final_text = ""
        confidence: float | None = None
        mfcc_dim = 0
        if self._realtime is not None:
            flushed = await asyncio.to_thread(self._realtime.flush)
            self._realtime.reset()
            final_text = flushed.text
            confidence = flushed.confidence
            mfcc_dim = flushed.mfcc_dim

        self.active = False
        events.append(EventEnvelope(type="stt.state", payload={"status": "stopped"}))
        if final_text:
            events.append(
                EventEnvelope(
                    type="stt.final",
                    payload={
                        "text": final_text,
                        "confidence": confidence,
                        "mfcc_dim": mfcc_dim,
                    },
                )
            )
        return events

    def _decode_chunk_to_float32(self, payload: dict[str, Any]) -> np.ndarray:
        if "audio_b64" in payload:
            raw = payload.get("audio_b64", "")
            if not isinstance(raw, str) or not raw:
                return np.asarray([], dtype=np.float32)
            try:
                pcm16 = base64.b64decode(raw, validate=True)
                chunk = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32)
                return chunk / 32768.0
            except Exception:
                return np.asarray([], dtype=np.float32)

        if "samples" in payload:
            samples = payload.get("samples")
            if not isinstance(samples, list):
                return np.asarray([], dtype=np.float32)
            values: list[float] = []
            for value in samples:
                if not isinstance(value, int):
                    continue
                clamped = max(-32768, min(32767, value))
                values.append(float(clamped) / 32768.0)
            if not values:
                return np.asarray([], dtype=np.float32)
            return np.asarray(values, dtype=np.float32)

        if "audio" in payload:
            audio = payload.get("audio")
            if not isinstance(audio, list):
                return np.asarray([], dtype=np.float32)
            float_values = [float(value) for value in audio if isinstance(value, (int, float))]
            if not float_values:
                return np.asarray([], dtype=np.float32)
            return np.asarray(float_values, dtype=np.float32)

        return np.asarray([], dtype=np.float32)

    def _resample_to_target_rate(
        self,
        audio: np.ndarray,
        source_rate: int,
        target_rate: int,
    ) -> np.ndarray:
        if source_rate == target_rate:
            return audio
        if source_rate <= 0:
            return audio
        factor = math.gcd(source_rate, target_rate)
        up = target_rate // factor
        down = source_rate // factor
        return np.asarray(resample_poly(audio, up, down), dtype=np.float32)

    def _endpoint_silence_ms(self) -> int:
        profile = self._active_profile
        if profile is None:
            return self.silence_duration_ms
        profile_silence_ms = int(getattr(profile, "min_end_ms", self.silence_duration_ms)) + 350
        return max(MIN_FINALIZE_SILENCE_MS, min(self.silence_duration_ms, profile_silence_ms))

    def _minimum_speech_ms(self) -> int:
        profile = self._active_profile
        if profile is None:
            return 80
        return max(40, int(getattr(profile, "min_start_ms", 80)))
