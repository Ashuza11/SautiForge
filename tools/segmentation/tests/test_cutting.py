import csv
import json
import subprocess
import tempfile
import unittest

import numpy as np
from pathlib import Path

from sautiseg.audio import sha256_file
from sautiseg.cutting import cut_accepted
from sautiseg.manifest import build_clip_record, build_manifest, write_manifest
from sautiseg.separate import write_mono_wav
from sautiseg.clips import build_clips


def make_source(path: Path) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
                    "-ar", "48000", "-ac", "2", str(path)], check=True)


class CutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.source = self.dir / "src.wav"
        make_source(self.source)
        self.work = self.dir / "out" / "src"
        self.work.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def manifest(self, review, with_vocals=True):
        clips = build_clips([(1000, 5000), (7000, 11_000)], 12_000)
        records = [build_clip_record(c, {}) for c in clips]
        records[0]["review"].update(review)
        source = {"fileName": "src.wav", "sha256": sha256_file(self.source), "durationMs": 12_000, "sourceUrl": "https://x"}
        if with_vocals:
            vocals = self.work / "vocals_44k.wav"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=12",
                            "-ac", "1", str(vocals)], check=True)
            source.update({"vocals44Audio": vocals.name, "vocals44Sha256": sha256_file(vocals)})
        path = self.work / "manifest.json"
        write_manifest(path, build_manifest(source=source, processing={}, spans=[], clips=records))
        return path

    def test_exports_only_accepted_clips_with_hashes(self):
        path = self.manifest({"status": "accepted", "transcript": "mbote", "tier": "asr_tts", "hasMusic": False})
        result = cut_accepted(path, self.source, sample_rate=16000)
        self.assertEqual((result["count"], result["tts"]), (1, 1))
        rows = list(csv.DictReader((self.work / "export" / "metadata.csv").open(encoding="utf-8")))
        self.assertEqual(len(rows), 1)
        wav = self.work / "export" / rows[0]["file"]
        self.assertEqual(sha256_file(wav), rows[0]["sha256"])
        self.assertEqual(rows[0]["transcript"], "mbote")
        self.assertEqual(json.loads((self.work / "export" / "export.json").read_text())["ttsCount"], 1)
        self.assertEqual(rows[0]["audio_variant"], "original")

    def test_tts_clips_are_cut_from_the_vocals_not_the_original(self):
        path = self.manifest({"status": "accepted", "transcript": "x", "tier": "asr_tts", "hasMusic": False})
        cut_accepted(path, self.source, sample_rate=16000)
        asr = list(csv.DictReader((self.work / "export" / "metadata.csv").open(encoding="utf-8")))[0]
        tts = list(csv.DictReader((self.work / "export" / "metadata_tts.csv").open(encoding="utf-8")))[0]
        self.assertTrue(tts["file"].startswith("tts_clips/"))
        self.assertTrue(tts["audio_variant"].startswith("vocals_"))
        self.assertNotEqual(asr["sha256"], tts["sha256"])
        self.assertEqual(sha256_file(self.work / "export" / tts["file"]), tts["sha256"])

    def test_tts_tier_without_vocals_is_refused(self):
        path = self.manifest({"status": "accepted", "transcript": "x", "tier": "asr_tts", "hasMusic": False}, with_vocals=False)
        with self.assertRaises(ValueError):
            cut_accepted(path, self.source)

    def test_tampered_vocals_are_refused(self):
        path = self.manifest({"status": "accepted", "transcript": "x", "tier": "asr_tts", "hasMusic": False})
        vocals = self.work / "vocals_44k.wav"
        vocals.write_bytes(vocals.read_bytes() + b"\0")
        with self.assertRaises(ValueError):
            cut_accepted(path, self.source)

    def test_exports_speaker_role_and_name(self):
        path = self.manifest({"status": "accepted", "tier": "asr_tts", "hasMusic": False, "speakerRole": "character", "speaker": "Peter"})
        cut_accepted(path, self.source, sample_rate=16000)
        for name in ("metadata.csv", "metadata_tts.csv"):
            row = list(csv.DictReader((self.work / "export" / name).open(encoding="utf-8")))[0]
            self.assertEqual((row["speaker_role"], row["speaker"]), ("character", "Peter"))

    def test_asr_tier_is_not_in_tts_file(self):
        path = self.manifest({"status": "accepted", "transcript": "x", "tier": "asr", "hasMusic": True}, with_vocals=False)
        cut_accepted(path, self.source)
        rows = list(csv.DictReader((self.work / "export" / "metadata_tts.csv").open(encoding="utf-8")))
        self.assertEqual(rows, [])

    def pause_manifest(self):
        rate = 44100
        t = np.arange(rate * 12) / rate
        tone = 0.5 * np.sin(2 * np.pi * 440 * t)
        voice = np.zeros_like(tone)
        for a, b in ((0.5, 2.0), (4.6, 6.1)):  # speech, then a 2.6 s silence, then more speech
            voice[int(a * rate):int(b * rate)] = tone[int(a * rate):int(b * rate)]
        vocals = self.work / "vocals_44k.wav"
        write_mono_wav(vocals, voice, rate)
        clip = build_clip_record(build_clips([(500, 2000)], 12_000)[0], {})
        clip.update({"startMs": 300, "endMs": 6300, "durationMs": 6000})
        clip["review"].update({"status": "accepted", "tier": "asr_tts", "hasMusic": False})
        source = {"fileName": "src.wav", "sha256": sha256_file(self.source), "durationMs": 12_000,
                  "vocals44Audio": vocals.name, "vocals44Sha256": sha256_file(vocals)}
        path = self.work / "manifest.json"
        write_manifest(path, build_manifest(source=source, processing={}, spans=[(500, 2000), (4600, 6100)], clips=[clip]))
        return path

    def test_tts_copy_shortens_long_silences_but_asr_copy_is_untouched(self):
        path = self.pause_manifest()
        cut_accepted(path, self.source, sample_rate=16000, max_pause_ms=500)
        asr = list(csv.DictReader((self.work / "export" / "metadata.csv").open(encoding="utf-8")))[0]
        tts = list(csv.DictReader((self.work / "export" / "metadata_tts.csv").open(encoding="utf-8")))[0]
        self.assertAlmostEqual(float(asr["duration_s"]), 6.0, delta=0.05)
        self.assertEqual(asr["trimmed_ms"], "0")
        self.assertAlmostEqual(float(tts["duration_s"]), 3.9, delta=0.05)   # 6000 - (2600 - 500)
        self.assertEqual(tts["trimmed_ms"], "2100")
        self.assertEqual(json.loads((self.work / "export" / "export.json").read_text())["maxPauseMs"], 500)

    def test_pause_shortening_can_be_switched_off(self):
        path = self.pause_manifest()
        cut_accepted(path, self.source, sample_rate=16000, max_pause_ms=0)
        tts = list(csv.DictReader((self.work / "export" / "metadata_tts.csv").open(encoding="utf-8")))[0]
        self.assertAlmostEqual(float(tts["duration_s"]), 6.0, delta=0.05)
        self.assertEqual(tts["trimmed_ms"], "0")

    def test_accepted_clip_without_a_transcript_exports_with_an_empty_transcript(self):
        path = self.manifest({"status": "accepted", "tier": "asr"}, with_vocals=False)
        cut_accepted(path, self.source)
        rows = list(csv.DictReader((self.work / "export" / "metadata.csv").open(encoding="utf-8")))
        self.assertEqual(rows[0]["transcript"], "")

    def test_refuses_wrong_source(self):
        path = self.manifest({"status": "accepted", "transcript": "x", "tier": "asr"})
        other = self.dir / "other.wav"
        make_source(other)
        other.write_bytes(other.read_bytes() + b"\0")
        with self.assertRaises(ValueError):
            cut_accepted(path, other)

    def test_refuses_when_nothing_accepted(self):
        path = self.manifest({})
        with self.assertRaises(ValueError):
            cut_accepted(path, self.source)


if __name__ == "__main__":
    unittest.main()
