from __future__ import annotations

import unittest

from app.stt.vad import RMSVoiceActivityDetector


def make_frame(amplitude: int, samples: int = 320) -> bytes:
    # 320 samples @16kHz equals 20ms.
    out = bytearray()
    for _ in range(samples):
        out.extend(int(amplitude).to_bytes(2, byteorder="little", signed=True))
    return bytes(out)


class TestRMSVAD(unittest.TestCase):
    def test_calibration_and_speech_transition(self) -> None:
        vad = RMSVoiceActivityDetector(
            sample_rate=16000,
            frame_ms=20,
            calibration_seconds=0.2,
            start_multiplier=2.5,
            end_multiplier=1.8,
            min_start_ms=40,
            min_end_ms=100,
            noise_ema_alpha=0.05,
            min_rms_floor=0.001,
        )

        # 10 frames * 20ms = 200ms calibration with low-noise input.
        for _ in range(10):
            decision = vad.process_frame(make_frame(200))
        self.assertTrue(decision.just_calibrated)

        # Two louder frames should trigger speech start.
        d1 = vad.process_frame(make_frame(2500))
        d2 = vad.process_frame(make_frame(2500))
        self.assertFalse(d1.just_started)
        self.assertTrue(d2.just_started)
        self.assertTrue(d2.is_speech)

        # Sustained silence should eventually end speech.
        ended = False
        for _ in range(6):
            d = vad.process_frame(make_frame(100))
            if d.just_ended:
                ended = True
                break
        self.assertTrue(ended)


if __name__ == "__main__":
    unittest.main()
