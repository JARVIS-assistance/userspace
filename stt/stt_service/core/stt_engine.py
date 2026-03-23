from concurrent.futures import Future, ThreadPoolExecutor
import numpy as np
from dataclasses import dataclass
from numpy.typing import NDArray
from typing import Optional

from .dsp import AudioPreprocessor
from .feature_extraction import FeatureExtractor
from .acoustic_model import (
    AcousticModel,
    DecoderLanguageModel,
    StreamingDecoderLanguageModel,
)
from .whisper_backend import WhisperBackend


FloatArray = NDArray[np.float32]


@dataclass
class Transcription:
    text: str
    confidence: Optional[float]
    duration_sec: float
    mfcc_dim: int


@dataclass
class StreamingTranscription:
    text: str
    is_final: bool
    confidence: Optional[float]
    mfcc_dim: int


class STTEngine:
    def __init__(
        self,
        sample_rate: int = 16000,
        model_path: str = "models/vosk-model-small-ko-0.22",
        backend: str = "vosk",
        whisper_model_size: str = "small",
        whisper_device: str = "auto",
        whisper_compute_type: str = "int8",
        whisper_cpu_threads: int = 2,
        whisper_realtime_interval_sec: float = 0.8,
        whisper_max_window_sec: float = 4.0,
    ):
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
                language="ko",
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


class RealTimeSTT:
    def __init__(
        self,
        stt_engine: STTEngine,
        buffer_size: int = 1600,
        silence_threshold: float = 0.01,
        min_speech_duration: float = 0.3,
        silence_duration: float = 0.5
    ):
        self.stt_engine = stt_engine
        self.buffer_size = buffer_size
        self.silence_threshold = silence_threshold
        self.min_speech_duration = min_speech_duration
        self.silence_duration = silence_duration
        
        self.audio_buffer = []
        self.is_recording = False
        self.speech_start_time = None
        self.silence_count = 0

    def add_audio_chunk(self, chunk: FloatArray) -> Optional[str]:
        is_speech = self._detect_speech(chunk)

        if is_speech:
            self.audio_buffer.append(chunk)
            self.silence_count = 0
        else:
            if len(self.audio_buffer) > 0:
                self.silence_count += len(chunk) / self.stt_engine.sample_rate

                if self.silence_count >= self.silence_duration:
                    audio_data = np.concatenate(self.audio_buffer)

                    speech_duration = len(audio_data) / self.stt_engine.sample_rate
                    if speech_duration >= self.min_speech_duration:
                        result = self.stt_engine.transcribe(audio_data)
                        self.audio_buffer = []
                        self.speech_start_time = None
                        return result.text

                    self.audio_buffer = []
                    self.silence_count = 0

        return None

    def _detect_speech(self, chunk: FloatArray) -> bool:
        rms = np.sqrt(np.mean(chunk ** 2))
        return rms > self.silence_threshold

    def reset(self):
        self.audio_buffer = []
        self.speech_start_time = None
        self.silence_count = 0


class RealTimePartialSTT:
    def __init__(self, stt_engine: STTEngine):
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
        self.last_partial_confidence: Optional[float] = None
        self.decode_generation = 0
        self.executor: Optional[ThreadPoolExecutor] = (
            ThreadPoolExecutor(max_workers=1)
            if stt_engine.backend == "whisper"
            else None
        )
        self.pending_future: Optional[Future[tuple[int, str, Optional[float]]]] = None

    def _run_whisper_decode(self, audio: FloatArray, generation: int) -> tuple[int, str, Optional[float]]:
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
                merged = merged[-self.max_buffer_samples:]
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
            whisper_result = self.stt_engine.whisper_backend.transcribe(merged, self.stt_engine.sample_rate)
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
        else:
            assert self.streaming_decoder is not None
            self.streaming_decoder.reset()
