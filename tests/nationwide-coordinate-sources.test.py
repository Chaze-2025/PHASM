"""Offline regression checks for the read-only source coordinate collector."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import gzip
import hashlib
from unittest import mock

SPEC = importlib.util.spec_from_file_location("coordinate_sources", Path(__file__).resolve().parents[1] / "scripts/nationwide-coordinate-sources.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SourceCoordinatesTest(unittest.TestCase):
    def setUp(self):
        self.record = {"name": "Albertville Public Library", "city": "Albertville", "state": "Alabama"}
        self.content = '''<title>Albertville Public Library - Alabama Real Haunt</title><h1>Albertville Public Library</h1><meta property="place:location:latitude" content="34.264313"><meta property="place:location:longitude" content="-86.203250"><div class="mt-3 attraction-address">220 Jackson St<br>Albertville, AL 35950</div>'''

    def test_meta_coordinates_and_address(self):
        page = MODULE.extract(self.content, "https://www.alabamahauntedhouses.com/real-haunt/albertville-public-library.html")
        self.assertEqual(len(page["points"]), 1)
        point = page["points"][0]
        self.assertEqual((point["latitude"], point["longitude"]), (34.264313, -86.20325))
        self.assertEqual(point["address"], "220 Jackson St Albertville, AL 35950")
        self.assertTrue(MODULE.identity_check(self.record, point, page)["valid"])

    def test_json_ld_avoids_related_place_coordinates(self):
        content = '''<title>The Manor - Albertville, AL | Haunted Places</title><script type="application/ld+json">{"@type":"TouristAttraction","name":"The Manor","geo":{"latitude":34.2,"longitude":-86.2},"address":{"addressRegion":"Alabama","addressLocality":"Albertville"},"containedInPlace":{"name":"Different Place","geo":{"latitude":40,"longitude":-120}}}</script>'''
        page = MODULE.extract(content, "https://www.hauntedplaces.org/item/the-manor/")
        self.assertEqual(len(page["points"]), 1)
        self.assertEqual(page["points"][0]["latitude"], 34.2)

    def test_unrelated_identity_rejected(self):
        page = MODULE.extract(self.content, "https://example.com")
        other = {**self.record, "name": "Winchester Mystery House"}
        self.assertFalse(MODULE.identity_check(other, page["points"][0], page)["valid"])

    def test_wrong_state_and_city_rejected(self):
        page = MODULE.extract(self.content, "https://example.com")
        point = {**page["points"][0], "address": {"addressRegion": "Georgia", "addressLocality": "Atlanta"}}
        self.assertFalse(MODULE.identity_check(self.record, point, page)["valid"])
        point["address"] = {"addressRegion": "Alabama", "addressLocality": "Birmingham"}
        self.assertTrue(MODULE.identity_check(self.record, point, page)["localityConflict"])

    def test_city_explicitly_in_street_address_resolves_nearest_town_metadata(self):
        page = MODULE.extract(self.content, "https://example.com")
        point = {**page["points"][0], "address": {"streetAddress": "220 Jackson St Albertville, AL 35950", "addressRegion": "Alabama", "addressLocality": "Nearby town"}}
        check = MODULE.identity_check(self.record, point, page)
        self.assertTrue(check["localityConflict"])
        self.assertTrue(check["localitySupportedByStreetAddress"])
        self.assertTrue(check["valid"])

    def test_apostrophes_and_theatre_spelling_normalize(self):
        self.assertEqual(MODULE.normalized("Hawaiʻi Theatre"), MODULE.normalized("Hawaii Theater"))
        self.assertEqual(MODULE.normalized("Eagle's Hall"), MODULE.normalized("Eagles Hall"))

    def test_wrong_coordinate_region_rejected(self):
        page = MODULE.extract(self.content, "https://example.com")
        point = {**page["points"][0], "latitude": 45.5, "longitude": -123.0}
        self.assertFalse(MODULE.identity_check(self.record, point, page)["valid"])

    def test_null_default_infinite_and_foreign_points_rejected(self):
        for coordinates in [(None, None), (0, 0), (float("nan"), -86), (float("inf"), -86), (51.5, -0.1)]:
            self.assertIsNone(MODULE.float_pair(*coordinates))
        self.assertIsNotNone(MODULE.float_pair(59.45, -135.31))
        self.assertIsNotNone(MODULE.float_pair(21.30, -157.85))

    def test_conflicting_embedded_points_rejected(self):
        extra = '<script type="application/ld+json">{"name":"Albertville Public Library","geo":{"latitude":34.3,"longitude":-86.3}}</script>'
        page = MODULE.extract(self.content + extra, "https://example.com")
        candidate = MODULE.make_candidate(self.record, {"ok": True, "url": "https://example.com", "page": page})
        self.assertEqual(candidate["status"], "ambiguous-coordinate")

    def test_cached_bytes_reparse_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            collector = MODULE.Collector(Path(temporary))
            url = "https://example.com/venue"
            key = hashlib.sha256(url.encode()).hexdigest()
            raw = self.content.encode()
            with gzip.open(collector.cache / (key + ".html.gz"), "wb") as handle:
                handle.write(raw)
            MODULE.save(collector.cache / (key + ".json"), {"ok": True, "url": url, "finalUrl": url, "sha256": hashlib.sha256(raw).hexdigest(), "htmlFile": key + ".html.gz", "page": {}})
            with mock.patch.object(MODULE.urllib.request, "urlopen", side_effect=AssertionError("network forbidden on rerun")):
                result = collector.fetch(url)
            self.assertEqual(result["page"]["points"][0]["latitude"], 34.264313)
            self.assertEqual(len(result["page"]["addressCandidates"]), 1)

    def test_cached_bytes_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            collector = MODULE.Collector(Path(temporary))
            url = "https://example.com/venue"
            key = hashlib.sha256(url.encode()).hexdigest()
            with gzip.open(collector.cache / (key + ".html.gz"), "wb") as handle:
                handle.write(b"changed")
            MODULE.save(collector.cache / (key + ".json"), {"ok": True, "url": url, "finalUrl": url, "sha256": "0" * 64, "htmlFile": key + ".html.gz"})
            with self.assertRaisesRegex(ValueError, "Cached source bytes changed"):
                collector.fetch(url)

    def test_accepted_points_always_approximate(self):
        page = MODULE.extract(self.content, "https://example.com")
        candidate = MODULE.make_candidate(self.record, {"ok": True, "url": "https://example.com", "page": page})
        self.assertEqual(candidate["status"], "accepted")
        self.assertEqual(candidate["coordinatePrecision"], "approximate")
        self.assertEqual(candidate["coordinateReference"]["scope"], "site")


if __name__ == "__main__":
    unittest.main()
