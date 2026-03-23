from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.config import load_settings


class TestConfigLoading(unittest.TestCase):
    def test_loads_ultra_low_latency_profile_from_json(self) -> None:
        payload = {
            "server": {"host": "0.0.0.0", "port": 9999, "env": "test"},
            "stt": {
                "model_name": "base",
                "default_profile": "ultra_low_latency",
                "profiles": {
                    "ultra_low_latency": {
                        "frame_ms": 8,
                        "partial_interval_ms": 160,
                    }
                },
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            settings = load_settings(str(path))

        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 9999)
        self.assertEqual(settings.stt_default_profile, "ultra_low_latency")
        self.assertEqual(settings.stt_model_name, "base")
        self.assertEqual(settings.stt_profiles["ultra_low_latency"].frame_ms, 8)
        self.assertEqual(settings.stt_profiles["ultra_low_latency"].partial_interval_ms, 160)


if __name__ == "__main__":
    unittest.main()
