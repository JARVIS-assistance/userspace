from __future__ import annotations

import time
import unittest

from app.config import STTProfileSettings
from app.stt.session import STTSession


class FakeTranscriptionResult:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeEngine:
    def __init__(self) -> None:
        self.transcribe_calls = 0
        self.last_pcm16_len = 0

    def ensure_loaded_sync(self) -> None:
        return None

    def transcribe_pcm16_sync(self, pcm16: bytes, sample_rate: int) -> FakeTranscriptionResult:
        self.transcribe_calls += 1
        self.last_pcm16_len = len(pcm16)
        return FakeTranscriptionResult(text="test")


class FakeStreamingResult:
    def __init__(self, text: str = "", is_final: bool = False) -> None:
        self.text = text
        self.is_final = is_final
        self.confidence = 0.9
        self.mfcc_dim = 1


class FakeRealtime:
    def __init__(self) -> None:
        self.add_calls = 0
        self.flush_calls = 0

        class EngineLike:
            sample_rate = 16000

        self.stt_engine = EngineLike()

    def add_audio_chunk(self, chunk) -> FakeStreamingResult:
        self.add_calls += 1
        return FakeStreamingResult(text="partial", is_final=False)

    def flush(self) -> FakeStreamingResult:
        self.flush_calls += 1
        return FakeStreamingResult(text="final", is_final=True)

    def reset(self) -> None:
        return None


class FakeRealtimeEngine(FakeEngine):
    def __init__(self) -> None:
        super().__init__()
        self.runtime = FakeRealtime()

    def create_runtime(self) -> FakeRealtime:
        return self.runtime


class TestSTTSessionProfiles(unittest.IsolatedAsyncioTestCase):
    async def test_start_with_ultra_low_latency_profile(self) -> None:
        profiles = {
            "default": STTProfileSettings(
                frame_ms=20,
                calibration_seconds=1.2,
                start_multiplier=2.8,
                end_multiplier=1.8,
                min_start_ms=80,
                min_end_ms=280,
                noise_ema_alpha=0.08,
                min_rms_floor=0.003,
                pre_roll_ms=120,
                partial_interval_ms=600,
            ),
            "ultra_low_latency": STTProfileSettings(
                frame_ms=10,
                calibration_seconds=0.8,
                start_multiplier=2.6,
                end_multiplier=1.7,
                min_start_ms=40,
                min_end_ms=160,
                noise_ema_alpha=0.1,
                min_rms_floor=0.003,
                pre_roll_ms=60,
                partial_interval_ms=220,
            ),
        }

        session = STTSession(
            engine=FakeEngine(),
            sample_rate=16000,
            default_profile="default",
            profiles=profiles,
            emit_debug_state=False,
        )

        events = await session.handle_start({"profile": "ultra_low_latency"})
        self.assertEqual(events[0].type, "stt.state")
        self.assertEqual(events[0].payload["profile"], "ultra_low_latency")
        self.assertEqual(events[0].payload["frame_ms"], 10)

    async def test_start_with_unknown_profile_returns_error(self) -> None:
        profiles = {
            "default": STTProfileSettings(
                frame_ms=20,
                calibration_seconds=1.2,
                start_multiplier=2.8,
                end_multiplier=1.8,
                min_start_ms=80,
                min_end_ms=280,
                noise_ema_alpha=0.08,
                min_rms_floor=0.003,
                pre_roll_ms=120,
                partial_interval_ms=600,
            )
        }

        session = STTSession(
            engine=FakeEngine(),
            sample_rate=16000,
            default_profile="default",
            profiles=profiles,
            emit_debug_state=False,
        )

        events = await session.handle_start({"profile": "not_found"})
        self.assertEqual(events[0].type, "error")

    async def test_silence_finalizes_even_before_partial_text(self) -> None:
        profiles = {
            "default": STTProfileSettings(
                frame_ms=20,
                calibration_seconds=1.2,
                start_multiplier=2.8,
                end_multiplier=1.8,
                min_start_ms=80,
                min_end_ms=120,
                noise_ema_alpha=0.08,
                min_rms_floor=0.003,
                pre_roll_ms=120,
                partial_interval_ms=600,
            )
        }
        engine = FakeEngine()
        session = STTSession(
            engine=engine,
            sample_rate=16000,
            default_profile="default",
            profiles=profiles,
            emit_debug_state=False,
            silence_duration_ms=1500,
        )

        await session.handle_start({})
        speech_samples = [12000] * 1600
        await session.handle_audio_chunk({"samples": speech_samples, "sample_rate": 16000})
        self.assertEqual(engine.transcribe_calls, 0)
        now = time.time()
        session._speech_start_time = now - 1.1
        session._last_speech_time = now - 1.0

        events = await session.handle_audio_chunk({"samples": [0] * 1600, "sample_rate": 16000})

        self.assertEqual([event.type for event in events], ["stt.final"])
        self.assertEqual(events[0].payload["text"], "test")
        self.assertEqual(engine.transcribe_calls, 1)
        self.assertGreater(engine.last_pcm16_len, 0)

    async def test_endpoint_first_silently_resets_long_open_turn(self) -> None:
        session = STTSession(
            engine=FakeEngine(),
            sample_rate=16000,
            default_profile="default",
            profiles={},
            emit_debug_state=False,
            max_open_turn_seconds=1,
        )

        await session.handle_start({})
        await session.handle_audio_chunk({"samples": [12000] * 1600, "sample_rate": 16000})
        session._speech_start_time = time.time() - 2.0
        session._last_speech_time = time.time()

        events = await session.handle_audio_chunk({"samples": [12000] * 1600, "sample_rate": 16000})

        self.assertEqual(events, [])
        self.assertFalse(session._has_speech)
        self.assertEqual(session._endpoint_buffer, [])

    async def test_realtime_partial_mode_preserves_partial_events(self) -> None:
        engine = FakeRealtimeEngine()
        session = STTSession(
            engine=engine,
            sample_rate=16000,
            default_profile="default",
            profiles={},
            emit_debug_state=False,
            turn_mode="realtime_partial",
        )

        await session.handle_start({})
        events = await session.handle_audio_chunk({"samples": [12000] * 1600, "sample_rate": 16000})

        self.assertEqual([event.type for event in events], ["stt.partial"])
        self.assertEqual(events[0].payload["text"], "partial")
        self.assertEqual(engine.runtime.add_calls, 1)

    async def test_stop_flushes_endpoint_first_open_buffer(self) -> None:
        engine = FakeEngine()
        session = STTSession(
            engine=engine,
            sample_rate=16000,
            default_profile="default",
            profiles={},
            emit_debug_state=False,
        )

        await session.handle_start({})
        await session.handle_audio_chunk({"samples": [12000] * 1600, "sample_rate": 16000})
        events = await session.handle_stop()

        self.assertEqual([event.type for event in events], ["stt.state", "stt.final"])
        self.assertEqual(engine.transcribe_calls, 1)


if __name__ == "__main__":
    unittest.main()
