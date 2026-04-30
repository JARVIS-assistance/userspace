"""실시간 partial STT — 청크 단위 audio를 누적하며 partial/final 결과 반환."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor

import numpy as np
from numpy.typing import NDArray

from app.stt.acoustic_model import StreamingDecoderLanguageModel
from app.stt.engine import STTEngine, StreamingTranscription


FloatArray = NDArray[np.float32]


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

    def _run_whisper_decode(
        self, audio: FloatArray, generation: int
    ) -> tuple[int, str, float | None]:
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
