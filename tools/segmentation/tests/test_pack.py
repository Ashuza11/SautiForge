import json
import tempfile
import unittest
from pathlib import Path

from sautiseg.encode import pcm_sha256
from sautiseg.pack import pack
from tests.test_publish import make_export


class PackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = make_export(Path(self.tmp.name) / "export")
        self.logs = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_pack(self, **kwargs):
        return pack(self.root, log=self.logs.append, **kwargs)

    def test_writes_one_verified_flac_per_clip_and_a_manifest(self):
        result = self.run_pack()
        out = Path(result["dir"])
        self.assertEqual(out, self.root.parent / "upload")
        self.assertEqual(sorted(p.name for p in out.glob("*.flac")), ["c001.flac", "c002.flac", "c003.flac"])
        self.assertEqual((out / "c001.flac").read_bytes()[:4], b"fLaC")
        manifest = json.loads((out / "pack.json").read_text())
        by_key = {c["clipKey"]: c for c in manifest["clips"]}
        self.assertEqual(by_key["c001"]["derivedFrom"], "cleaned")
        self.assertEqual(by_key["c003"]["derivedFrom"], "original")
        self.assertEqual(by_key["c001"]["pcmSha256"], pcm_sha256(self.root / "tts_clips" / "c001.wav"))
        self.assertEqual(by_key["c001"]["durationMs"], 2500)

    def test_originals_are_never_touched(self):
        before = (self.root / "tts_clips" / "c001.wav").read_bytes()
        self.run_pack()
        self.assertEqual((self.root / "tts_clips" / "c001.wav").read_bytes(), before)

    def test_can_pack_a_small_selection(self):
        out = Path(self.run_pack(only=["c002", "c003"])["dir"])
        self.assertEqual(sorted(p.name for p in out.glob("*.flac")), ["c002.flac", "c003.flac"])

    def test_first_limits_the_count(self):
        result = pack(self.root, Path(self.tmp.name) / "few", first=1, log=self.logs.append)
        self.assertEqual(result["count"], 1)

    def test_refuses_unknown_clip_keys_and_empty_selections(self):
        with self.assertRaisesRegex(RuntimeError, "not in the export"):
            self.run_pack(only=["c999"])
        with self.assertRaisesRegex(RuntimeError, "no clips"):
            self.run_pack(first=0)


if __name__ == "__main__":
    unittest.main()
