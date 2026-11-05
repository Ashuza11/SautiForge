import unittest

from sautiseg.clips import build_clips
from sautiseg.manifest import SCHEMA, build_clip_record, build_manifest, validate_manifest

SOURCE = {"fileName": "a.mp4", "sha256": "0" * 64, "durationMs": 60_000}


def manifest_with(review_patch=None):
    clips = build_clips([(1000, 5000)], 60_000)
    record = build_clip_record(clips[0], {"rmsDb": -20.0})
    record["review"].update(review_patch or {})
    return build_manifest(source=SOURCE, processing={}, spans=[(1000, 5000)], clips=[record])


class ManifestTests(unittest.TestCase):
    def test_fresh_manifest_is_valid(self):
        manifest = manifest_with()
        self.assertEqual(manifest["schema"], SCHEMA)
        validate_manifest(manifest)

    def test_accepted_needs_a_tier_but_not_a_transcript(self):
        with self.assertRaises(ValueError):
            validate_manifest(manifest_with({"status": "accepted"}))
        validate_manifest(manifest_with({"status": "accepted", "tier": "asr"}))  # community transcribes later
        validate_manifest(manifest_with({"status": "accepted", "transcript": "x", "tier": "asr"}))

    def test_tts_tier_requires_confirmed_no_music(self):
        patch = {"status": "accepted", "transcript": "x", "tier": "asr_tts"}
        with self.assertRaises(ValueError):
            validate_manifest(manifest_with({**patch, "hasMusic": None}))
        with self.assertRaises(ValueError):
            validate_manifest(manifest_with({**patch, "hasMusic": True}))
        validate_manifest(manifest_with({**patch, "hasMusic": False}))

    def test_speaker_role_must_be_known_but_may_be_absent(self):
        validate_manifest(manifest_with({"speakerRole": "narrator"}))
        validate_manifest(manifest_with({"speakerRole": "character", "speaker": "Peter"}))
        validate_manifest(manifest_with({"speakerRole": None}))
        with self.assertRaises(ValueError):
            validate_manifest(manifest_with({"speakerRole": "actor"}))

    def test_removed_sections_must_be_inside_ordered_and_not_overlap(self):
        def with_removed(removed):
            manifest = manifest_with()
            manifest["clips"][0]["removed"] = removed
            return manifest
        validate_manifest(with_removed([]))
        validate_manifest(with_removed([{"startMs": 1500, "endMs": 2000}, {"startMs": 2500, "endMs": 3000}]))
        for bad in ([{"startMs": 500, "endMs": 2000}], [{"startMs": 2000, "endMs": 1500}],
                    [{"startMs": 2500, "endMs": 3000}, {"startMs": 1500, "endMs": 2000}], [{"startMs": 1500, "endMs": 2600}, {"startMs": 2500, "endMs": 3000}]):
            with self.assertRaises(ValueError):
                validate_manifest(with_removed(bad))

    def test_rejected_needs_reason(self):
        with self.assertRaises(ValueError):
            validate_manifest(manifest_with({"status": "rejected"}))
        validate_manifest(manifest_with({"status": "rejected", "rejectReason": "music only"}))

    def test_boundaries_must_fit_source(self):
        manifest = manifest_with()
        manifest["clips"][0]["endMs"] = 61_000
        manifest["clips"][0]["durationMs"] = 61_000 - manifest["clips"][0]["startMs"]
        with self.assertRaises(ValueError):
            validate_manifest(manifest)

    def test_unknown_schema_rejected(self):
        manifest = manifest_with()
        manifest["schema"] = "other/9"
        with self.assertRaises(ValueError):
            validate_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
