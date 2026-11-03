import unittest

from sautiseg.clips import ClipParams, build_clips, normalize_spans

P = ClipParams()
TOTAL = 120_000


class NormalizeTests(unittest.TestCase):
    def test_sorts_clamps_and_merges(self):
        self.assertEqual(normalize_spans([(5000, 6000), (-50, 1000), (900, 1500), (7000, 7000), (118_000, 130_000)], TOTAL),
                         [(0, 1500), (5000, 6000), (118_000, 120_000)])


class BuildClipsTests(unittest.TestCase):
    def test_empty_input_gives_no_clips(self):
        self.assertEqual(build_clips([], TOTAL), [])

    def test_never_cuts_inside_a_span(self):
        spans = [(1000, 4000), (4300, 8000), (8200, 9500), (12000, 15000), (15200, 17000)]
        for clip in build_clips(spans, TOTAL):
            for start, end in spans:
                self.assertFalse(clip.start_ms > start and clip.start_ms < end, f"{clip.id} starts inside a span")
                self.assertFalse(clip.end_ms > start and clip.end_ms < end, f"{clip.id} ends inside a span")

    def test_closes_at_a_sentence_pause_once_long_enough(self):
        spans = [(0, 2000), (2200, 4000), (5000, 7000)]  # 1000 ms pause after 4 s of speech
        clips = build_clips(spans, TOTAL)
        self.assertEqual([c.span_count for c in clips], [2, 1])

    def test_short_pause_does_not_split(self):
        clips = build_clips([(0, 2000), (2300, 4000), (4400, 6000)], TOTAL)
        self.assertEqual(len(clips), 1)
        self.assertEqual(clips[0].cut_candidates_ms, [2150, 4200])

    def test_does_not_split_at_pause_before_preferred_length(self):
        clips = build_clips([(0, 1000), (2000, 3000)], TOTAL)  # 1 s pause but only 1 s of speech
        self.assertEqual(len(clips), 1)

    def test_target_max_forces_a_split_at_a_pause(self):
        spans = [(0, 6000), (6300, 11_000), (11_300, 16_000)]
        clips = build_clips(spans, TOTAL)
        self.assertEqual([c.span_count for c in clips], [2, 1])
        self.assertTrue(all(c.duration_ms <= P.target_max_ms + 2 * P.pad_ms for c in clips))

    def test_tiny_group_stretches_instead_of_fragmenting(self):
        clips = build_clips([(0, 800), (1000, 14_000)], TOTAL)  # 0.8 s then a 13 s phrase
        self.assertEqual(len(clips), 1)
        self.assertIn("over_target", clips[0].flags)

    def test_single_long_span_is_flagged_not_cut(self):
        clips = build_clips([(0, 25_000)], TOTAL)
        self.assertEqual(len(clips), 1)
        self.assertIn("needs_manual_split", clips[0].flags)

    def test_padding_never_enters_neighbour_or_file_bounds(self):
        clips = build_clips([(50, 4000), (4100, 4200), (8000, 11_000)], 11_050)
        self.assertEqual(clips[0].start_ms, 0)
        self.assertEqual(clips[-1].end_ms, 11_050)
        for a, b in zip(clips, clips[1:]):
            self.assertLessEqual(a.end_ms, b.start_ms)

    def test_never_joins_across_a_long_silence(self):
        clips = build_clips([(0, 1000), (14_000, 15_000)], TOTAL)
        self.assertEqual(len(clips), 2)
        self.assertIn("too_short", clips[0].flags)

    def test_flags_a_long_silence_inside_a_clip(self):
        clips = build_clips([(0, 1500), (2800, 4000)], TOTAL, ClipParams(max_gap_ms=2000))  # allowed to join across 1.3 s
        self.assertEqual(len(clips), 1)
        self.assertIn("long_internal_pause", clips[0].flags)
        self.assertEqual(clips[0].max_internal_gap_ms, 1300)
        self.assertNotIn("long_internal_pause", build_clips([(0, 1500), (1900, 4000)], TOTAL)[0].flags)

    def test_default_never_joins_across_more_than_a_second_of_silence(self):
        self.assertEqual(len(build_clips([(0, 1000), (3000, 4000)], TOTAL)), 2)
        self.assertEqual(len(build_clips([(0, 1500), (2800, 4000)], TOTAL)), 2)

    def test_flags(self):
        clips = build_clips([(0, 1000), (9000, 13_000)], TOTAL)
        self.assertIn("too_short", clips[0].flags)
        self.assertIn("tts_length_ok", clips[1].flags)

    def test_ids_are_sequential_and_padded(self):
        clips = build_clips([(0, 4000), (6000, 10_000), (12_000, 16_000)], TOTAL)
        self.assertEqual([c.id for c in clips], ["c001", "c002", "c003"])

    def test_invalid_params_rejected(self):
        with self.assertRaises(ValueError):
            ClipParams(min_clip_ms=5000, min_preferred_ms=3000).validate()


if __name__ == "__main__":
    unittest.main()
