"""LocalWhisperEngine — STTEngine + RealTimePartialSTT 라이프사이클 래퍼."""

from __future__ import annotations

import math

import numpy as np

from app.stt.engine import STTEngine, STTEngineUnavailableError, TranscriptionResult
from app.stt.realtime import RealTimePartialSTT


class LocalWhisperEngine:
    def __init__(
        self,
        *,
        model_name: str,
        device: str,
        compute_type: str,
        language: str,
        sample_rate: int = 16000,
        realtime_interval_ms: int = 300,
        cpu_threads: int = 4,
    ) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.sample_rate = sample_rate
        self.realtime_interval_sec = realtime_interval_ms / 1000.0
        self.cpu_threads = cpu_threads

        self._engine: STTEngine | None = None
        self._load_error: str | None = None

    @property
    def is_ready(self) -> bool:
        return self._engine is not None

    def ensure_loaded_sync(self) -> None:
        if self._engine is not None:
            return
        if self._load_error is not None:
            raise STTEngineUnavailableError(self._load_error)
        try:
            self._engine = STTEngine(
                sample_rate=self.sample_rate,
                backend="whisper",
                whisper_model_size=self.model_name,
                whisper_language=self.language,
                whisper_device=self.device,
                whisper_compute_type=self.compute_type,
                whisper_cpu_threads=self.cpu_threads,
                whisper_realtime_interval_sec=self.realtime_interval_sec,
            )
        except Exception as exc:
            self._load_error = (
                "Failed to initialize STT engine from faster-whisper backend. "
                f"reason={exc}"
            )
            raise STTEngineUnavailableError(self._load_error) from exc

    def create_runtime(self) -> RealTimePartialSTT:
        self.ensure_loaded_sync()
        assert self._engine is not None
        return RealTimePartialSTT(stt_engine=self._engine)

    def transcribe_pcm16_sync(self, pcm16: bytes, sample_rate: int) -> TranscriptionResult:
        self.ensure_loaded_sync()
        if not pcm16:
            return TranscriptionResult(text="")

        chunk = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32)
        audio = chunk / 32768.0
        if sample_rate != self.sample_rate:
            from scipy.signal import resample_poly

            factor = math.gcd(sample_rate, self.sample_rate)
            up = self.sample_rate // factor
            down = sample_rate // factor
            audio = np.asarray(resample_poly(audio, up, down), dtype=np.float32)

        assert self._engine is not None
        result = self._engine.transcribe(audio)
        return TranscriptionResult(text=result.text)
