import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from sautiseg.dataset import build_dataset, split_for
from sautiseg.encode import pcm_sha256
from sautiseg.pack import pack
from tests.test_publish import SOURCE, TOKEN, make_export

API = "https://api.example.org"


class FakeService:
    """The export list and the signed FLAC downloads."""

    def __init__(self, manifest: dict, files: dict[str, bytes]):
        self.manifest, self.files, self.calls = manifest, files, []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url))
        if url.startswith("https://storage.example/"):
            data = self.files.get(url.removeprefix("https://storage.example/"))
            return (200, data) if data is not None else (404, b"")
        assert headers["Authorization"] == f"Bearer {TOKEN}"
        if url == f"{API}/v1/admin/sources/{SOURCE}/export":
            return 200, json.dumps(self.manifest).encode()
        return 404, b"{}"


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.export = make_export(self.base / "export")
        self.pack_dir = self.base / "upload"
        pack(self.export, self.pack_dir, log=lambda *_: None)
        self.pack_json = self.pack_dir / "pack.json"
        self.entries = {e["clipKey"]: e for e in json.loads(self.pack_json.read_text())["clips"]}
        self.logs = []

    def tearDown(self):
        self.tmp.cleanup()

    def service(self, *, rights=None, transcripts=None, tamper=None, drop_pcm=True, only=None):
        files, clips = {}, []
        for key, entry in self.entries.items():
            if only and key not in only:
                continue
            data = (self.pack_dir / entry["file"]).read_bytes()
            if tamper == key:
                data = data[:-4] + b"\x00\x00\x00\x00"
            files[f"{key}.flac"] = data
            clips.append({
                "clipId": f"id-{key}", "clipKey": key, "transcript": (transcripts or {}).get(key, f"words of {key}"), "finalVersion": 2,
                "note": "checked", "durationMs": entry["durationMs"], "transcribers": 2, "sampleRate": entry["sampleRate"],
                "derivedFrom": entry["derivedFrom"],
                "flac": {"url": f"https://storage.example/{key}.flac", "sha256": entry["flacSha256"], "sizeBytes": entry["sizeBytes"],
                         "pcmSha256": None if drop_pcm else entry["pcmSha256"]},
            })
        manifest = {
            "generatedAt": "2026-11-10T12:00:00.000Z",
            "project": {"id": "p", "title": "Mashi corpus", "languageCode": "shr", "targetLanguage": "Shi", "languageVariety": "Mashi"},
            "source": {"id": SOURCE, "title": "A film", "originalUrl": "https://example.org/v", "creator": None},
            "rights": rights if rights is not None else {"decision": "approved", "rightsHolder": "Owner", "permissionEvidence": "Confirmed by the admin",
                                                        "authorizedUses": {"publicDistribution": False, "transcription": True}},
            "totals": {"approved": len(clips), "excluded": 1, "notExported": 0, "durationMs": sum(c["durationMs"] for c in clips)},
            "clips": clips,
        }
        return FakeService(manifest, files)

    def run_build(self, service, out="dataset", **kwargs):
        return build_dataset(API, TOKEN, SOURCE, self.base / out, http=service, log=self.logs.append, **kwargs)

    def rows(self, out="dataset"):
        with (self.base / out / "metadata.csv").open(newline="", encoding="utf-8") as handle:
            return {row["clip_id"]: row for row in csv.DictReader(handle)}

    def test_builds_wav_files_that_have_exactly_the_original_audio_samples(self):
        result = self.run_build(self.service(), pack_json=self.pack_json)
        self.assertEqual((result["built"], result["failed"]), (3, []))
        for key, entry in self.entries.items():
            wav = self.base / "dataset" / "wavs" / f"{key}.wav"
            self.assertEqual(pcm_sha256(wav), entry["pcmSha256"])
            self.assertEqual(self.rows()[key]["sha256"], hashlib.sha256(wav.read_bytes()).hexdigest())

    def test_writes_metadata_with_transcripts_splits_and_hashes(self):
        self.run_build(self.service(transcripts={"c001": "mwâna wa, \"Mashi\""}))
        rows = self.rows()
        self.assertEqual(list(rows), ["c001", "c002", "c003"])
        self.assertEqual(rows["c001"]["transcript"], "mwâna wa, \"Mashi\"")
        self.assertEqual({r["split"] for r in rows.values()} <= {"train", "dev", "test"}, True)
        self.assertEqual(rows["c001"]["split"], split_for(SOURCE, "c001"))
        self.assertEqual((rows["c001"]["final_version"], rows["c001"]["transcribers"], rows["c001"]["note"]), ("2", "2", "checked"))
        self.assertEqual(rows["c003"]["derived_from"], "original")
        self.assertEqual(rows["c001"]["flac_sha256"], self.entries["c001"]["flacSha256"])

    def test_counts_hours_once_and_writes_the_summary_and_a_clear_permission_note(self):
        self.run_build(self.service(), pack_json=self.pack_json, export_dir=self.export)
        summary = json.loads((self.base / "dataset" / "dataset.json").read_text())
        seconds = sum(e["durationMs"] for e in self.entries.values()) / 1000
        self.assertAlmostEqual(summary["totals"]["seconds"], seconds, places=2)
        self.assertEqual(summary["totals"]["clips"], 3)
        self.assertEqual(summary["totals"]["musicCopies"], 2)  # music copies are not added to the hours
        self.assertFalse(summary["shareablePublicly"])
        self.assertEqual(sum(summary["totals"]["splits"].values()), 3)
        readme = (self.base / "dataset" / "README.md").read_text()
        self.assertIn("NOT cleared for public distribution", readme)
        self.assertIn("Confirmed by the admin", readme)

    def test_says_so_when_public_sharing_is_allowed(self):
        rights = {"decision": "approved", "rightsHolder": "Owner", "permissionEvidence": "x", "authorizedUses": {"publicDistribution": True}}
        self.run_build(self.service(rights=rights))
        self.assertTrue(json.loads((self.base / "dataset" / "dataset.json").read_text())["shareablePublicly"])
        self.assertIn("Cleared for public distribution: yes", (self.base / "dataset" / "README.md").read_text())

    def test_joins_music_copies_by_clip_key_and_checks_them(self):
        self.run_build(self.service(), pack_json=self.pack_json, export_dir=self.export)
        rows = self.rows()
        self.assertEqual(rows["c001"]["music_audio_file"], "wavs_music/c001.wav")
        self.assertEqual((self.base / "dataset" / "wavs_music" / "c001.wav").read_bytes(), (self.export / "clips" / "c001.wav").read_bytes())
        self.assertEqual(rows["c003"]["music_audio_file"], "")  # c003's stored audio already is the original
        self.assertFalse((self.base / "dataset" / "wavs_music" / "c003.wav").exists())

    def test_refuses_a_music_copy_that_was_changed_or_does_not_match_the_clip(self):
        (self.export / "clips" / "c001.wav").write_bytes((self.export / "clips" / "c001.wav").read_bytes() + b"\0\0")
        result = self.run_build(self.service(), out="a", pack_json=self.pack_json, export_dir=self.export)
        self.assertEqual([f["clip"] for f in result["failed"]], ["c001"])
        self.assertIn("recorded hash", result["failed"][0]["error"])
        self.assertFalse((self.base / "a" / "metadata.csv").exists())

    def test_detects_a_damaged_download_and_finishes_nothing(self):
        result = self.run_build(self.service(tamper="c002"), out="b")
        self.assertEqual([f["clip"] for f in result["failed"]], ["c002"])
        self.assertIn("does not match", result["failed"][0]["error"])
        self.assertFalse((self.base / "b" / "metadata.csv").exists())
        self.assertFalse((self.base / "b" / "wavs" / "c002.wav").exists())

    def test_detects_wrong_audio_samples_even_when_the_download_is_intact(self):
        service = self.service(drop_pcm=False)
        next(c for c in service.manifest["clips"] if c["clipKey"] == "c001")["flac"]["pcmSha256"] = "0" * 64
        result = self.run_build(service, out="c")
        self.assertEqual([f["clip"] for f in result["failed"]], ["c001"])
        self.assertIn("audio samples", result["failed"][0]["error"])

    def test_is_careful_about_overwriting_and_bad_arguments(self):
        self.run_build(self.service())
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.run_build(self.service())
        self.assertEqual(self.run_build(self.service(), overwrite=True)["built"], 3)
        with self.assertRaises(ValueError):
            build_dataset(API, TOKEN, "bad-id", self.base / "x", http=self.service())
        with self.assertRaisesRegex(ValueError, "--pack"):
            self.run_build(self.service(), out="y", export_dir=self.export)
        with self.assertRaisesRegex(RuntimeError, "No clip is approved"):
            self.run_build(self.service(only=["none"]), out="z")

    def test_dry_run_downloads_nothing(self):
        service = self.service()
        result = self.run_build(service, out="d", dry_run=True)
        self.assertEqual(result["clips"], 3)
        self.assertFalse((self.base / "d").exists())
        self.assertFalse([c for c in service.calls if "storage.example" in c[1]])

    def test_split_is_stable_and_close_to_80_10_10(self):
        keys = [f"c{i:04d}" for i in range(2000)]
        first = [split_for(SOURCE, k) for k in keys]
        self.assertEqual(first, [split_for(SOURCE, k) for k in keys])
        counts = {name: first.count(name) for name in ("train", "dev", "test")}
        self.assertTrue(1500 < counts["train"] < 1700 and 120 < counts["dev"] < 280 and 120 < counts["test"] < 280, counts)
        self.assertNotEqual(first, [split_for("00000000-0000-4000-8000-0000000000ff", k) for k in keys])


if __name__ == "__main__":
    unittest.main()
