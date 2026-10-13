"""Focused regressions for area-marker identity selection; no network requests."""

import importlib.util
import unittest
from collections import defaultdict
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "localities", Path(__file__).parents[1] / "scripts/nationwide-coordinate-localities.py"
)
localities = importlib.util.module_from_spec(spec)
spec.loader.exec_module(localities)


class LocalityIdentityTests(unittest.TestCase):
    def indexes(self):
        return {kind: defaultdict(list) for kind in (
            "places", "populated", "cousubs", "counties", "area"
        )}

    def point(self, label, identifier, latitude, longitude, primary=None):
        return {
            "dataset": "test", "lookupId": identifier, "label": label,
            "latitude": latitude, "longitude": longitude,
            "primaryNames": primary or [label],
        }

    def test_distant_cottonwood_namesakes_remain_ambiguous(self):
        indexes = self.indexes()
        indexes["places"][("cottonwood", "Arizona")] = [
            self.point("Cottonwood city", "0416410", 34.751, -111.984, ["Cottonwood"]),
            self.point("Cottonwood CDP", "0416360", 36.072, -109.890, ["Cottonwood"]),
        ]
        selected, candidates = localities.select_name(indexes, "Cottonwood", "Arizona")
        self.assertIsNone(selected)
        self.assertEqual(len(candidates), 2)

    def test_canonical_kailua_kona_beats_unrelated_haiku_alias(self):
        indexes = self.indexes()
        indexes["populated"][("kailuakona", "Hawaii")] = [
            self.point("Haiku", "5847490", 20.892, -156.214),
            self.point("Kailua-Kona", "5847504", 19.640, -155.999),
        ]
        selected, _ = localities.select_name(indexes, "Kailua-Kona", "Hawaii")
        self.assertEqual(selected["lookupId"], "5847504")

    def test_honolulu_populated_place_precedes_remote_county_subdivision(self):
        indexes = self.indexes()
        indexes["populated"][("honolulu", "Hawaii")] = [
            self.point("Honolulu", "5856195", 21.307, -157.858),
        ]
        indexes["cousubs"][("honolulu", "Hawaii")] = [
            self.point("Honolulu CCD", "bad-city-reference", 27.793, -175.848, ["Honolulu"]),
        ]
        selected, _ = localities.select_name(indexes, "Honolulu", "Hawaii")
        self.assertEqual(selected["lookupId"], "5856195")

    def test_word_boundaries_distinguish_valley_view_and_valleyview(self):
        indexes = self.indexes()
        indexes["places"][("valleyview", "Ohio")] = [
            self.point("Valleyview", "wrong", 39.964, -83.072),
            self.point("Valley View", "correct", 41.382, -81.608),
        ]
        selected, _ = localities.select_name(indexes, "Valley View", "Ohio")
        self.assertEqual(selected["lookupId"], "correct")

    def test_missing_city_does_not_match_an_unrelated_place(self):
        selected, candidates = localities.select_name(self.indexes(), "", "Arkansas")
        self.assertIsNone(selected)
        self.assertEqual(candidates, [])

    def test_composite_area_only_exposes_explicit_names(self):
        variants = localities.query_variants("Leroy / Walhalla area")
        names = [name for name, _ in variants]
        self.assertIn("Leroy", names)
        self.assertIn("Walhalla", names)
        self.assertNotIn("North Dakota", names)


if __name__ == "__main__":
    unittest.main()
