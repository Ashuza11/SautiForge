"""Vocal separation with Demucs. Produces a processed copy; the original is never changed.

Uses the Demucs Python API with ffmpeg for decoding and the standard library for writing,
so it does not depend on torchaudio.
"""

from __future__ import annotations

import subprocess
import time
import wave
from pathlib import Path

import numpy as np

MODEL_NAME = "htdemucs"
MODEL_RATE = 44100


def decode_stereo(path: Path, *, start_s: float | None = None, duration_s: float | None = None) -> np.ndarray:
    """Decode any media to float32 stereo at the model rate, shape (2, samples)."""
    command = ["ffmpeg", "-v", "error"]
    if start_s is not None:
        command += ["-ss", f"{start_s:.3f}"]
    if duration_s is not None:
        command += ["-t", f"{duration_s:.3f}"]
    command += ["-i", str(path), "-vn", "-ac", "2", "-ar", str(MODEL_RATE), "-f", "f32le", "-"]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode(errors='replace')[-400:]}")
    data = np.frombuffer(result.stdout, dtype=np.float32)
    if data.size == 0:
        raise RuntimeError("No audio decoded from the input.")
    return data.reshape(-1, 2).T.copy()


def write_mono_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(samples, -1.0, 1.0)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((pcm * 32767.0).astype("<i2").tobytes())


def separate_vocals(stereo: np.ndarray, *, model_name: str = MODEL_NAME, threads: int = 4) -> tuple[np.ndarray, dict]:
    """Return mono float32 vocals at 44.1 kHz and run details."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(threads)
    model = get_model(model_name)
    model.eval()
    if "vocals" not in model.sources:
        raise ValueError(f"{model_name} has no vocals stem.")
    wav = torch.from_numpy(stereo)
    reference = wav.mean(0)
    wav = (wav - reference.mean()) / (reference.std() + 1e-8)

    started = time.time()
    with torch.no_grad():
        sources = apply_model(model, wav[None], device="cpu", split=True, overlap=0.25, progress=True)[0]
    vocals = sources[model.sources.index("vocals")] * (reference.std() + 1e-8) + reference.mean()
    mono = vocals.mean(0).numpy().astype(np.float32)
    details = {"model": model_name, "device": "cpu", "overlap": 0.25, "seconds": round(time.time() - started, 1),
               "inputSeconds": round(stereo.shape[1] / MODEL_RATE, 1)}
    return mono, details


def ensure_separation(source: Path, source_sha: str, out_dir: Path, *, model_name: str = MODEL_NAME,
                      threads: int = 4, log=print) -> dict:
    """Separate vocals for the whole file once; reuse the result while the source and model match."""
    import json

    from .audio import WORKING_SAMPLE_RATE, run, sha256_file

    info_path, v44, v16 = out_dir / "separation.json", out_dir / "vocals_44k.wav", out_dir / "vocals_16k.wav"
    if info_path.exists() and v44.exists() and v16.exists():
        info = json.loads(info_path.read_text(encoding="utf-8"))
        if (info.get("sourceSha256") == source_sha and info.get("model") == model_name
                and info.get("vocals44Sha256") == sha256_file(v44)):
            log(f"      Reusing existing separation ({info['seconds']} s of compute earlier)")
            return info

    log("      Decoding stereo audio")
    stereo = decode_stereo(source)
    log(f"      Separating vocals with {model_name} on CPU (progress bar below)")
    vocals, details = separate_vocals(stereo, model_name=model_name, threads=threads)
    del stereo
    write_mono_wav(v44, vocals, MODEL_RATE)
    run(["ffmpeg", "-y", "-v", "error", "-i", str(v44), "-ac", "1", "-ar", str(WORKING_SAMPLE_RATE),
         "-c:a", "pcm_s16le", str(v16)])
    info = {**details, "sourceSha256": source_sha, "vocals44": v44.name, "vocals44Sha256": sha256_file(v44),
            "vocals16": v16.name}
    info_path.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    return info
