import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("coordinate_merge", Path(__file__).parents[1] / "scripts/nationwide-coordinate-merge.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def point(latitude=40, longitude=-100, scope="site"):
    return {
        "latitude": latitude, "longitude": longitude,
        "coordinatePrecision": "approximate",
        "coordinateReference": {"scope": scope, "label": "Sourced reference", "sourceUrl": "https://example.org/source"},
        "evidence": {"sourceSha256": "a" * 64},
    }


class CoordinateMergeTests(unittest.TestCase):
    def setUp(self):
        self.catalog = [
            {"id": "existing", "latitude": 39, "longitude": -101, "coordinatePrecision": "exact", "state": "Kansas", "name": "Existing", "city": "Example", "photos": ["keep"], "updatedAt": "old"},
            {"id": "missing", "latitude": None, "longitude": None, "coordinatePrecision": "withheld", "state": "Kansas", "name": "Missing", "city": "Example", "photos": ["keep"], "updatedAt": "old"},
        ]

    def test_preserves_every_non_geographic_field_and_existing_pin(self):
        source = {"id": "missing", "status": "accepted", **point()}
        result = module.merge(self.catalog, {"records": [source]}, [], {"byLocationId": {}})
        after, choices, missing, warnings = result
        self.assertEqual(after[0], self.catalog[0])
        self.assertEqual(after[1]["photos"], ["keep"])
        self.assertEqual(after[1]["updatedAt"], "old")
        self.assertEqual(choices[0]["method"], "source-map")
        self.assertEqual(missing, [])
        self.assertEqual(warnings, [])
        self.assertEqual(result, module.merge(self.catalog, {"records": [source]}, [], {"byLocationId": {}}))

    def test_website_failure_still_gets_labeled_area_pin(self):
        sources = {"records": [{"id": "missing", "status": "fetch-failed"}]}
        result = module.merge(self.catalog, sources, [], {"byLocationId": {"missing": point(scope="locality")}})
        self.assertEqual(result[0][1]["coordinateReference"]["scope"], "locality")
        self.assertEqual(result[2], [])

    def test_conflicting_site_evidence_is_flagged_and_uses_labeled_area(self):
        sources = {"records": [{"id": "missing", "status": "accepted", **point()}]}
        addresses = [{"records": {"missing": point(latitude=41)}}]
        area = {"byLocationId": {"missing": point(latitude=40.1, scope="locality")}}
        after, choices, missing, warnings = module.merge(self.catalog, sources, addresses, area)
        self.assertEqual(choices[0]["method"], "area-reference-conflict")
        self.assertEqual(after[1]["coordinateReference"]["scope"], "locality")
        self.assertTrue(warnings)
        self.assertEqual(missing, [])

    def test_rejects_unverifiable_points_and_identity_mismatches(self):
        for change in [{"latitude": float("nan")}, {"coordinatePrecision": "exact"}, {"evidence": None}]:
            with self.assertRaises(ValueError):
                module.validate_point({**point(), **change})
        bad = point()
        bad["coordinateReference"]["sourceUrl"] = "javascript:alert(1)"
        with self.assertRaises(ValueError):
            module.validate_point(bad)
        with self.assertRaises(ValueError):
            module.merge(self.catalog, {"records": []}, [], {"byLocationId": {"unknown": point()}})

    def test_missing_evidence_never_invents_a_pin(self):
        after, choices, missing, warnings = module.merge(self.catalog, {"records": []}, [], {"byLocationId": {}})
        self.assertEqual(after, self.catalog)
        self.assertEqual(missing[0]["id"], "missing")
        self.assertEqual(choices, [])


if __name__ == "__main__":
    unittest.main()
