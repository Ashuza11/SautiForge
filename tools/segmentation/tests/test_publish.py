import csv
import hashlib
import json
import tempfile
import unittest
import wave
from pathlib import Path

from sautiseg.cutting import COLUMNS
from sautiseg.encode import pcm_sha256
from sautiseg.publish import load_export, publish

SOURCE = "00000000-0000-4000-8000-000000000101"
TOKEN = "t" * 40


def write_wav(path: Path, ms: int, rate: int = 24000) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x01\x00" * (rate * ms // 1000))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def row(clip_id, variant, folder, sha, start=1000, end=4000, **extra):
    base = dict.fromkeys(COLUMNS, "")
    base.update(clip_id=clip_id, file=f"{folder}/{clip_id}.wav", audio_variant=variant, start_ms=start, end_ms=end,
                duration_s="3.0", trimmed_ms=0, sample_rate=24000, sha256=sha, speaker_role="narrator",
                speaker="Voice A", has_music="false", tier="asr_tts")
    base.update(extra)
    return base


def make_export(root: Path, clips=("c001", "c002"), original_only=("c003",)) -> Path:
    original, cleaned = [], []
    for offset, clip_id in enumerate(original_only):
        start = 30000 + offset * 5000
        original.append(row(clip_id, "original", "clips", write_wav(root / "clips" / f"{clip_id}.wav", 2000), start, start + 2000, tier="asr", has_music="true"))
    for index, clip_id in enumerate(clips):
        start = 1000 + index * 5000
        original.append(row(clip_id, "original", "clips", write_wav(root / "clips" / f"{clip_id}.wav", 3000), start, start + 3000))
        cleaned.append(row(clip_id, "vocals_htdemucs", "tts_clips", write_wav(root / "tts_clips" / f"{clip_id}.wav", 2500), start, start + 3000))
    for name, rows in (("metadata.csv", original), ("metadata_tts.csv", cleaned)):
        with (root / name).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            writer.writeheader()
            writer.writerows(rows)
    (root / "export.json").write_text(json.dumps({"processing": {"tool": "sautiseg", "toolVersion": "0.1.0"}}))
    return root


class FakeService:
    """Stands in for the API and for S3 (signed upload URLs)."""

    def __init__(self):
        self.clips = {}
        self.uploaded = {}
        self.calls = []
        self.fail_put_for = None

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url))
        if url.startswith("https://storage.example/"):
            key = url.removeprefix("https://storage.example/")
            if self.fail_put_for and self.fail_put_for in key:
                return 403, b""
            self.uploaded[key] = body
            return 200, b""
        assert headers["Authorization"] == f"Bearer {TOKEN}"
        path = url.split("example.org", 1)[1]
        if path.endswith("/clips") and method == "POST":
            draft = json.loads(body)
            clip = self.clips.setdefault(draft["clipKey"], {"id": f"id-{draft['clipKey']}", "status": "draft", "draft": draft, "verified": set()})
            files = []
            for audio in draft["audio"]:
                variant = audio["variant"]
                key = f"{clip['id']}/{variant}.{'flac' if variant == 'master' else 'opus'}"
                files.append({"file": {"variant": variant},
                              "upload": None if variant in clip["verified"] else {"url": f"https://storage.example/{key}", "headers": {"x-amz-checksum-sha256": "x"}}})
            return 200, json.dumps({"clip": {"id": clip["id"], "status": clip["status"]}, "files": files}).encode()
        if path.endswith("/complete"):
            clip = next(c for c in self.clips.values() if path.endswith(f"/{c['id']}/complete"))
            for audio in clip["draft"]["audio"]:
                if audio["variant"] in clip["verified"]:
                    continue
                if f"{clip['id']}/{audio['variant']}.{'flac' if audio['variant'] == 'master' else 'opus'}" not in self.uploaded:
                    return 409, json.dumps({"error": "object_unavailable", "message": "not readable yet"}).encode()
                clip["verified"].add(audio["variant"])
            clip["status"] = "published"
            return 200, json.dumps({"clip": {"id": clip["id"], "status": "published"}, "files": []}).encode()
        return 404, b"{}"


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = make_export(Path(self.tmp.name) / "export")
        self.logs = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_publish(self, service, **kwargs):
        return publish(self.root, "https://api.example.org/", TOKEN, SOURCE, "ADMIN-01", http=service, log=self.logs.append, **kwargs)

    def test_loads_one_audio_choice_per_clip_and_metadata(self):
        clips, segmenter = load_export(self.root)
        self.assertEqual([c.clip_key for c in clips], ["c003", "c001", "c002"])
        by_key = {c.clip_key: c for c in clips}
        self.assertEqual(by_key["c001"].derived_from, "cleaned")
        self.assertEqual(by_key["c003"].derived_from, "original")
        first = by_key["c001"]
        self.assertEqual(first.duration_ms, 2500)  # the cleaned copy is what is published
        self.assertEqual(first.speaker_name, "Voice A")
        self.assertEqual(segmenter, "sautiseg 0.1.0")

    def test_encodes_a_flac_master_that_round_trips_and_an_opus_listening_copy(self):
        clips, segmenter = load_export(self.root)
        clip = clips[1]
        with tempfile.TemporaryDirectory() as scratch:
            clip.encode(Path(scratch))
            draft = clip.draft("ADMIN-01", segmenter)
            master, listening = draft["audio"]
            self.assertEqual((master["variant"], listening["variant"]), ("master", "listening"))
            self.assertEqual(master["derivedFrom"], "cleaned")
            self.assertEqual(master["pcmSha256"], pcm_sha256(clip.wav_path))
            self.assertIsNone(listening["pcmSha256"])
            self.assertEqual(clip.audio[0].path.read_bytes()[:4], b"fLaC")
            self.assertEqual(clip.audio[1].path.read_bytes()[:4], b"OggS")
            self.assertLess(listening["durationMs"], 2600)
            self.assertEqual(listening["sampleRate"], 48000)

    def test_dry_run_contacts_nothing(self):
        service = FakeService()
        result = self.run_publish(service, dry_run=True)
        self.assertEqual(result["published"], 0)
        self.assertEqual(service.calls, [])

    def test_publishes_every_clip_with_a_master_and_a_listening_copy(self):
        service = FakeService()
        result = self.run_publish(service)
        self.assertEqual((result["published"], result["failed"]), (3, []))
        self.assertEqual(len(service.uploaded), 6)
        self.assertEqual(service.uploaded["id-c001/master.flac"][:4], b"fLaC")
        self.assertEqual(service.uploaded["id-c001/listening.opus"][:4], b"OggS")
        self.assertEqual(service.clips["c003"]["draft"]["audio"][0]["derivedFrom"], "original")
        self.assertEqual(service.clips["c001"]["draft"]["audio"][0]["derivedFrom"], "cleaned")

    def test_rerun_uploads_nothing_again(self):
        service = FakeService()
        self.run_publish(service)
        service.uploaded.clear()
        service.calls.clear()
        result = self.run_publish(service)
        self.assertEqual(result["published"], 3)
        self.assertEqual(service.uploaded, {})
        self.assertFalse([c for c in service.calls if c[0] == "PUT"])

    def test_one_failure_does_not_stop_the_others_and_is_reported(self):
        service = FakeService()
        service.fail_put_for = "id-c001"
        result = self.run_publish(service)
        self.assertEqual(result["published"], 2)
        self.assertEqual(result["failed"][0]["clip"], "c001")
        service.fail_put_for = None
        self.assertEqual(self.run_publish(service)["published"], 3)

    def test_refuses_a_changed_audio_file(self):
        (self.root / "tts_clips" / "c001.wav").write_bytes((self.root / "tts_clips" / "c001.wav").read_bytes() + b"\0\0")
        with self.assertRaisesRegex(RuntimeError, "does not match the hash"):
            self.run_publish(FakeService())

    def test_refuses_an_export_with_no_metadata(self):
        (self.root / "metadata_tts.csv").unlink()
        (self.root / "metadata.csv").unlink()
        with self.assertRaisesRegex(RuntimeError, "nothing to publish"):
            load_export(self.root)

    def test_dry_run_still_encodes_and_reports_sizes(self):
        self.run_publish(FakeService(), dry_run=True)
        self.assertTrue(any("master" in line and "listening" in line for line in self.logs))

    def test_refuses_bad_arguments(self):
        with self.assertRaises(ValueError):
            publish(self.root, "https://a", TOKEN, "not-a-uuid", "ADMIN-01", http=FakeService())
        with self.assertRaises(ValueError):
            publish(self.root, "https://a", TOKEN, SOURCE, "bad code!", http=FakeService())

    def test_rejects_paths_outside_the_export_folder(self):
        text = (self.root / "metadata_tts.csv").read_text().replace("tts_clips/c001.wav", "../outside.wav")
        (self.root / "metadata_tts.csv").write_text(text)
        with self.assertRaisesRegex(RuntimeError, "outside the export folder"):
            load_export(self.root)


if __name__ == "__main__":
    unittest.main()
