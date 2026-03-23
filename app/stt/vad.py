from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class VadDecision:
    rms: float
    noise_rms: float
    start_threshold: float
    end_threshold: float
    is_speech: bool
    just_started: bool
    just_ended: bool
    just_calibrated: bool


class RMSVoiceActivityDetector:
    """RMS-based VAD with startup calibration and dynamic thresholding."""

    def __init__(
        self,
        *,
        sample_rate: int,
        frame_ms: int,
        calibration_seconds: float,
        start_multiplier: float,
        end_multiplier: float,
        min_start_ms: int,
        min_end_ms: int,
        noise_ema_alpha: float,
        min_rms_floor: float,
    ) -> None:
        self.sample_rate = sample_rate
        self.frame_ms = frame_ms
        self.calibration_frames = max(1, int((calibration_seconds * 1000) / frame_ms))
        self.start_multiplier = start_multiplier
        self.end_multiplier = end_multiplier
        self.min_start_frames = max(1, int(min_start_ms / frame_ms))
        self.min_end_frames = max(1, int(min_end_ms / frame_ms))
        self.noise_ema_alpha = noise_ema_alpha
        self.min_rms_floor = min_rms_floor

        self._calibration_rms: list[float] = []
        self._is_calibrated = False
        self._noise_rms = min_rms_floor

        self._is_speech = False
        self._speech_counter = 0
        self._silence_counter = 0

    @property
    def is_calibrated(self) -> bool:
        return self._is_calibrated

    def process_frame(self, frame_pcm16: bytes) -> VadDecision:
        rms = self._compute_rms(frame_pcm16)
        just_calibrated = False

        if not self._is_calibrated:
            self._calibration_rms.append(rms)
            if len(self._calibration_rms) >= self.calibration_frames:
                self._noise_rms = self._estimate_noise_floor(self._calibration_rms)
                self._is_calibrated = True
                just_calibrated = True

        if self._is_calibrated and not self._is_speech:
            # Adapt noise floor in non-speech region to track ambient changes.
            alpha = self.noise_ema_alpha
            self._noise_rms = max(
                self.min_rms_floor,
                ((1 - alpha) * self._noise_rms) + (alpha * rms),
            )

        start_threshold = max(self.min_rms_floor, self._noise_rms * self.start_multiplier)
        end_threshold = max(self.min_rms_floor, self._noise_rms * self.end_multiplier)

        just_started = False
        just_ended = False

        if not self._is_speech:
            if rms >= start_threshold:
                self._speech_counter += 1
            else:
                self._speech_counter = 0

            if self._speech_counter >= self.min_start_frames and self._is_calibrated:
                self._is_speech = True
                self._speech_counter = 0
                self._silence_counter = 0
                just_started = True
        else:
            if rms < end_threshold:
                self._silence_counter += 1
            else:
                self._silence_counter = 0

            if self._silence_counter >= self.min_end_frames:
                self._is_speech = False
                self._silence_counter = 0
                just_ended = True

        return VadDecision(
            rms=rms,
            noise_rms=self._noise_rms,
            start_threshold=start_threshold,
            end_threshold=end_threshold,
            is_speech=self._is_speech,
            just_started=just_started,
            just_ended=just_ended,
            just_calibrated=just_calibrated,
        )

    def _estimate_noise_floor(self, rms_values: list[float]) -> float:
        sorted_values = sorted(rms_values)
        if not sorted_values:
            return self.min_rms_floor

        # 30th percentile is stable enough for ambient baseline.
        index = max(0, int(len(sorted_values) * 0.3) - 1)
        return max(self.min_rms_floor, sorted_values[index])

    def _compute_rms(self, frame_pcm16: bytes) -> float:
        sample_count = len(frame_pcm16) // 2
        if sample_count == 0:
            return 0.0

        samples = memoryview(frame_pcm16).cast("h")
        sum_square = 0.0
        for sample in samples:
            normalized = sample / 32768.0
            sum_square += normalized * normalized

        return math.sqrt(sum_square / sample_count)
