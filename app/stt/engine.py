from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from app.stt.acoustic_model import (
    AcousticModel,
    DecoderLanguageModel,
    StreamingDecoderLanguageModel,
)
from app.stt.dsp import AudioPreprocessor
from app.stt.feature_extraction import FeatureExtractor
from app.stt.whisper_backend import WhisperBackend


FloatArray = NDArray[np.float32]


class STTEngineUnavailableError(RuntimeError):
    pass


@dataclass
class Transcription:
    text: str
    confidence: float | None
    duration_sec: float
    mfcc_dim: int


@dataclass
class StreamingTranscription:
    text: str
    is_final: bool
    confidence: float | None
    mfcc_dim: int


@dataclass(frozen=True)
class TranscriptionResult:
    text: str


class STTEngine:
    def __init__(
        self,
        sample_rate: int = 16000,
        model_path: str = "models/vosk-model-small-ko-0.22",
        backend: str = "vosk",
        whisper_model_size: str = "small",
        whisper_language: str = "ko",
        whisper_device: str = "auto",
        whisper_compute_type: str = "int8",
        whisper_cpu_threads: int = 2,
        whisper_realtime_interval_sec: float = 0.8,
        whisper_max_window_sec: float = 4.0,
    ) -> None:
        self.sample_rate = sample_rate
        self.backend = backend
        self.whisper_realtime_interval_sec = whisper_realtime_interval_sec
        self.whisper_max_window_sec = whisper_max_window_sec

        self.dsp = AudioPreprocessor(sample_rate=sample_rate)
        self.feature_extractor = FeatureExtractor(sample_rate=sample_rate)

        self.acoustic_model = AcousticModel(model_path=model_path)
        self.decoder_lm = DecoderLanguageModel(
            acoustic_model=self.acoustic_model,
            sample_rate=sample_rate,
        )
        self.whisper_backend = (
            WhisperBackend(
                model_size=whisper_model_size,
                language=whisper_language,
                device=whisper_device,
                compute_type=whisper_compute_type,
                cpu_threads=whisper_cpu_threads,
            )
            if backend == "whisper"
            else None
        )

    def process_audio(self, audio: FloatArray) -> Transcription:
        processed_audio = self.dsp.process(audio)
        features = self.feature_extractor.extract(processed_audio)

        decode_audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
        if self.backend == "whisper" and self.whisper_backend is not None:
            whisper_result = self.whisper_backend.transcribe(decode_audio, self.sample_rate)
            text = whisper_result.text
            confidence = whisper_result.confidence
        else:
            decode_result = self.decoder_lm.decode(decode_audio)
            text = decode_result.text
            confidence = decode_result.confidence

        duration_sec = len(audio) / float(self.sample_rate)
        return Transcription(
            text=text,
            confidence=confidence,
            duration_sec=duration_sec,
            mfcc_dim=int(features.shape[0]),
        )

    def transcribe(self, audio: FloatArray) -> Transcription:
        return self.process_audio(audio)


class RealTimePartialSTT:
    def __init__(self, stt_engine: STTEngine) -> None:
        self.stt_engine = stt_engine
        self.streaming_decoder = (
            None
            if stt_engine.backend == "whisper"
            else StreamingDecoderLanguageModel(
                acoustic_model=stt_engine.acoustic_model,
                sample_rate=stt_engine.sample_rate,
            )
        )
        self.buffer: list[FloatArray] = []
        self.max_buffer_samples = int(stt_engine.sample_rate * stt_engine.whisper_max_window_sec)
        self.decode_interval_samples = int(
            stt_engine.sample_rate * stt_engine.whisper_realtime_interval_sec
        )
        self.samples_since_decode = 0
        self.last_partial_text = ""
        self.last_partial_confidence: float | None = None
        self.decode_generation = 0
        self.executor: ThreadPoolExecutor | None = (
            ThreadPoolExecutor(max_workers=1) if stt_engine.backend == "whisper" else None
        )
        self.pending_future: Future[tuple[int, str, float | None]] | None = None

    def _run_whisper_decode(self, audio: FloatArray, generation: int) -> tuple[int, str, float | None]:
        assert self.stt_engine.whisper_backend is not None
        result = self.stt_engine.whisper_backend.transcribe(audio, self.stt_engine.sample_rate)
        return generation, result.text, result.confidence

    def _poll_pending_whisper(self) -> None:
        if self.pending_future is None:
            return
        if not self.pending_future.done():
            return
        try:
            generation, text, confidence = self.pending_future.result()
        except Exception:
            self.pending_future = None
            return
        self.pending_future = None
        if generation != self.decode_generation:
            return
        self.last_partial_text = text
        self.last_partial_confidence = confidence

    def add_audio_chunk(self, chunk: FloatArray) -> StreamingTranscription:
        processed_audio = self.stt_engine.dsp.process(chunk)
        features = self.stt_engine.feature_extractor.extract(processed_audio)
        decode_audio = np.clip(chunk, -1.0, 1.0).astype(np.float32)

        if self.stt_engine.backend == "whisper" and self.stt_engine.whisper_backend is not None:
            self._poll_pending_whisper()
            self.buffer.append(decode_audio)
            merged = np.concatenate(self.buffer)
            if len(merged) > self.max_buffer_samples:
                merged = merged[-self.max_buffer_samples :]
                self.buffer = [merged]

            self.samples_since_decode += len(decode_audio)
            if self.samples_since_decode < self.decode_interval_samples:
                return StreamingTranscription(
                    text=self.last_partial_text,
                    is_final=False,
                    confidence=self.last_partial_confidence,
                    mfcc_dim=int(features.shape[0]),
                )

            if self.pending_future is None and self.executor is not None:
                audio_snapshot = np.array(merged, dtype=np.float32, copy=True)
                self.pending_future = self.executor.submit(
                    self._run_whisper_decode,
                    audio_snapshot,
                    self.decode_generation,
                )
                self.samples_since_decode = 0

            return StreamingTranscription(
                text=self.last_partial_text,
                is_final=False,
                confidence=self.last_partial_confidence,
                mfcc_dim=int(features.shape[0]),
            )

        assert self.streaming_decoder is not None
        decode_result = self.streaming_decoder.feed(decode_audio)
        return StreamingTranscription(
            text=decode_result.text,
            is_final=decode_result.is_final,
            confidence=decode_result.confidence,
            mfcc_dim=int(features.shape[0]),
        )

    def flush(self) -> StreamingTranscription:
        if self.stt_engine.backend == "whisper" and self.stt_engine.whisper_backend is not None:
            if not self.buffer:
                return StreamingTranscription(text="", is_final=True, confidence=None, mfcc_dim=0)
            self._poll_pending_whisper()
            merged = np.concatenate(self.buffer)
            whisper_result = self.stt_engine.whisper_backend.transcribe(
                merged,
                self.stt_engine.sample_rate,
            )
            self.buffer = []
            self.last_partial_text = ""
            self.last_partial_confidence = None
            self.samples_since_decode = 0
            return StreamingTranscription(
                text=whisper_result.text,
                is_final=True,
                confidence=whisper_result.confidence,
                mfcc_dim=0,
            )

        assert self.streaming_decoder is not None
        decode_result = self.streaming_decoder.flush()
        return StreamingTranscription(
            text=decode_result.text,
            is_final=True,
            confidence=decode_result.confidence,
            mfcc_dim=0,
        )

    def reset(self) -> None:
        if self.stt_engine.backend == "whisper":
            self.decode_generation += 1
            self.buffer = []
            self.last_partial_text = ""
            self.last_partial_confidence = None
            self.samples_since_decode = 0
            if self.pending_future is not None and not self.pending_future.done():
                self.pending_future.cancel()
            self.pending_future = None
            return

        assert self.streaming_decoder is not None
        self.streaming_decoder.reset()


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
            import math

            factor = math.gcd(sample_rate, self.sample_rate)
            up = self.sample_rate // factor
            down = sample_rate // factor
            audio = np.asarray(resample_poly(audio, up, down), dtype=np.float32)

        assert self._engine is not None
        result = self._engine.transcribe(audio)
        return TranscriptionResult(text=result.text)
