import unittest

import numpy as np

from sautiseg.pauses import assemble, keep_ranges, kept_ms

SPANS = [(1000, 2000), (4600, 6200), (7000, 7600)]  # gaps of 2600 ms and 800 ms


class KeepRangesTests(unittest.TestCase):
    def test_shortens_every_pause_over_the_cap(self):
        ranges = keep_ranges(SPANS, 800, 7800, 500)  # 2600 ms and 800 ms pauses both exceed 500
        self.assertEqual(ranges, [(800, 2250), (4350, 6450), (6750, 7800)])
        self.assertEqual(kept_ms(ranges), 7000 - (2600 - 500) - (800 - 500))

    def test_leaves_pauses_at_or_under_the_cap(self):
        ranges = keep_ranges(SPANS, 800, 7800, 1000)  # only the 2600 ms pause is over 1000
        self.assertEqual(ranges, [(800, 2500), (4100, 7800)])

    def test_each_shortened_silence_is_exactly_the_cap(self):
        ranges = keep_ranges(SPANS, 800, 7800, 500)
        self.assertEqual((ranges[0][1] - 2000) + (4600 - ranges[1][0]), 500)
        self.assertEqual((ranges[1][1] - 6200) + (7000 - ranges[2][0]), 500)

    def test_a_pause_under_the_cap_is_untouched(self):
        self.assertEqual(keep_ranges([(1000, 2000), (2400, 3000)], 900, 3100, 500), [(900, 3100)])

    def test_disabled_keeps_everything(self):
        self.assertEqual(keep_ranges(SPANS, 800, 7800, 0), [(800, 7800)])

    def test_only_spans_inside_the_clip_count(self):
        self.assertEqual(keep_ranges(SPANS, 4500, 6300, 500), [(4500, 6300)])

    def test_edge_padding_is_never_cut(self):
        ranges = keep_ranges([(2000, 3000)], 0, 9000, 500)
        self.assertEqual(ranges, [(0, 9000)])

    def test_odd_cap_keeps_exactly_the_cap(self):
        ranges = keep_ranges(SPANS, 800, 7800, 501)
        self.assertEqual((ranges[0][1] - 2000) + (4600 - ranges[1][0]), 501)


class AssembleTests(unittest.TestCase):
    def test_joins_ranges_and_fades_the_seams(self):
        rate = 1000
        samples = np.ones(10_000, dtype=np.float32)
        joined = assemble(samples, rate, [(0, 2000), (6000, 8000)])
        self.assertEqual(len(joined), 4000)
        self.assertAlmostEqual(float(joined[0]), 1.0)          # nothing fades at the very start
        self.assertLess(float(joined[1999]), 0.3)              # fade out before the seam
        self.assertLess(float(joined[2000]), 0.3)              # fade in after the seam
        self.assertAlmostEqual(float(joined[3999]), 1.0)

    def test_single_range_is_a_plain_slice(self):
        samples = np.arange(5000, dtype=np.float32)
        self.assertTrue(np.array_equal(assemble(samples, 1000, [(1000, 3000)]), samples[1000:3000]))


if __name__ == "__main__":
    unittest.main()
