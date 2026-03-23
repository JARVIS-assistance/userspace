import argparse
import os

import numpy as np
import sounddevice as sd

from .core import STTEngine


def main() -> None:
    parser = argparse.ArgumentParser(description="Record mic audio and run STT")
    parser.add_argument("--seconds", type=float, default=5.0, help="Recording duration")
    parser.add_argument("--sample-rate", type=int, default=16000, help="Audio sample rate")
    parser.add_argument(
        "--model-path",
        type=str,
        default=os.getenv("STT_MODEL_PATH", "models/vosk-model-small-ko-0.22"),
        help="Vosk model directory",
    )
    args = parser.parse_args()

    print(f"Recording {args.seconds} seconds...")
    recording = sd.rec(
        int(args.seconds * args.sample_rate),
        samplerate=args.sample_rate,
        channels=1,
        dtype="float32",
    )
    sd.wait()

    audio = np.squeeze(recording, axis=1).astype(np.float32)
    engine = STTEngine(sample_rate=args.sample_rate, model_path=args.model_path)
    result = engine.transcribe(audio)

    print("--- Transcription ---")
    print(result.text)
    print(f"confidence={result.confidence}")
    print(f"duration_sec={result.duration_sec:.2f}")
    print(f"mfcc_dim={result.mfcc_dim}")


if __name__ == "__main__":
    main()
