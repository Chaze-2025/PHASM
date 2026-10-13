#!/usr/bin/env python3
"""Cache and audit coordinates explicitly published by a record's cited sources.

Read-only: never updates the PHASM catalog or a remote application. Every accepted
point is approximate; conflicts are retained for review. Re-running reuses cached
responses, including failures; --retry-failures retries only failed requests.
"""
import argparse
import concurrent.futures
import datetime
import gzip
import hashlib
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import sqlite3
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

VERSION = "phasm-coordinate-sources-1"
STATES = dict(zip(
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
    ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"],
))
STATE_CODES = {v: k for k, v in STATES.items()}
# Geographic sanity bounds from the US Census 2024 500k state boundary files.
# https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip
STATE_BOUNDS = {'Alabama': [-88.473227, 30.223334, -84.88908, 35.008028],
 'Alaska': [-179.146711, 51.215567, 179.77847, 71.387815],
 'American Samoa': [-171.089874, -14.548699, -168.1433, -11.046934],
 'Arizona': [-114.81651, 31.332177, -109.045223, 37.00426],
 'Arkansas': [-94.617919, 33.004291, -89.641003, 36.4996],
 'California': [-124.409591, 32.534435, -114.131211, 42.009485],
 'Colorado': [-109.060253, 36.992426, -102.041524, 41.003444],
 'Commonwealth of the Northern Mariana Islands': [144.886369, 14.110472, 146.064525, 20.553247],
 'Connecticut': [-73.727775, 40.980144, -71.786994, 42.050587],
 'Delaware': [-75.788658, 38.451196, -75.048939, 39.839007],
 'District of Columbia': [-77.119759, 38.791645, -76.909395, 38.99511],
 'Florida': [-87.634938, 24.521304, -80.031362, 31.000888],
 'Georgia': [-85.605165, 30.357851, -80.840378, 35.001244],
 'Guam': [144.618068, 13.234189, 144.956712, 13.654383],
 'Hawaii': [-178.334698, 18.910361, -154.806773, 28.402123],
 'Idaho': [-117.243027, 41.988209, -111.043564, 49.000911],
 'Illinois': [-91.513079, 36.970298, -87.495199, 42.508481],
 'Indiana': [-88.097892, 37.771742, -84.784579, 41.760592],
 'Iowa': [-96.638621, 40.375659, -90.140061, 43.501196],
 'Kansas': [-102.051744, 36.993016, -94.588413, 40.003162],
 'Kentucky': [-89.571509, 36.497129, -81.964971, 39.147458],
 'Louisiana': [-94.043147, 28.928609, -88.817017, 33.019457],
 'Maine': [-71.083924, 42.977764, -66.949895, 47.459686],
 'Maryland': [-79.487651, 37.911717, -75.048939, 39.723043],
 'Massachusetts': [-73.508142, 41.237964, -69.928393, 42.886589],
 'Michigan': [-90.418136, 41.696118, -82.413474, 48.2388],
 'Minnesota': [-97.239209, 43.499369, -89.493977, 49.384358],
 'Mississippi': [-91.655009, 30.175372, -88.097888, 34.996052],
 'Missouri': [-95.774704, 35.995683, -89.098843, 40.61364],
 'Montana': [-116.049155, 44.357962, -104.039563, 49.00139],
 'Nebraska': [-104.053514, 39.999998, -95.30829, 43.001708],
 'Nevada': [-120.006455, 35.001857, -114.039648, 42.002207],
 'New Hampshire': [-72.557247, 42.69699, -70.610621, 45.305476],
 'New Jersey': [-75.559537, 38.928519, -73.893628, 41.357423],
 'New Mexico': [-109.050173, 31.332301, -103.001964, 37.000232],
 'New York': [-79.762152, 40.496103, -71.856483, 45.01585],
 'North Carolina': [-84.321869, 33.842316, -75.460621, 36.588117],
 'North Dakota': [-104.0489, 45.935054, -96.554507, 49.000574],
 'Ohio': [-84.820157, 38.403202, -80.518693, 41.977164],
 'Oklahoma': [-103.002565, 33.615833, -94.430662, 37.002206],
 'Oregon': [-124.566244, 41.991794, -116.463504, 46.290834],
 'Pennsylvania': [-80.519891, 39.7198, -74.689516, 42.26986],
 'Puerto Rico': [-67.945404, 17.88328, -65.221077, 18.516023],
 'Rhode Island': [-71.862772, 41.146339, -71.12057, 42.018798],
 'South Carolina': [-83.35391, 32.037593, -78.547324, 35.215402],
 'South Dakota': [-104.057879, 42.479635, -96.436589, 45.94545],
 'Tennessee': [-90.310453, 34.982972, -81.6469, 36.678118],
 'Texas': [-106.645646, 25.837377, -93.508292, 36.500704],
 'United States Virgin Islands': [-65.085362, 17.674678, -64.565594, 18.415815],
 'Utah': [-114.052962, 36.997968, -109.041058, 42.001702],
 'Vermont': [-73.43774, 42.726853, -71.464555, 45.016659],
 'Virginia': [-83.675395, 36.540738, -75.242469, 39.466012],
 'Washington': [-124.763068, 45.543541, -116.915989, 49.002494],
 'West Virginia': [-82.644739, 37.201483, -77.719519, 40.638801],
 'Wisconsin': [-92.888114, 42.491983, -86.805415, 47.080621],
 'Wyoming': [-111.054556, 40.994746, -104.05216, 45.005815]}
STOPWORDS = set("the a an at and of in on for to old former historic historical haunted real haunt places place hotel house inn site school museum national state park bed breakfast church cemetery hospital building theater theatre road bridge hall fort county city plantation tavern university college public library restaurant military battlefield center centre home united states".split())


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def normalized(value):
    value = unicodedata.normalize("NFKD", html.unescape(str(value or "")))
    value = "".join(c for c in value if not unicodedata.combining(c)).lower()
    value = re.sub("['’‘ʻʼ`´]", "", value)
    value = re.sub(r"[^a-z0-9]+", " ", value).strip()
    replacements = {"theatre": "theater", "inne": "inn", "alaskan": "alaska"}
    return " ".join(replacements.get(token, token) for token in value.split())


class Page(HTMLParser):
    def __init__(self, content):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.scripts = []
        self.title = ""
        self.heading = ""
        self.script = None
        self.in_title = False
        self.in_heading = False
        self.feed(content)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "meta":
            key = attrs.get("property") or attrs.get("name") or attrs.get("itemprop")
            if key and "content" in attrs:
                self.meta[key.lower()] = attrs["content"]
        if tag == "script" and attrs.get("type", "").lower() == "application/ld+json":
            self.script = ""
        if tag == "title":
            self.in_title = True
        if tag == "h1":
            self.in_heading = True

    def handle_endtag(self, tag):
        if tag == "script" and self.script is not None:
            try:
                self.scripts.append(json.loads(self.script))
            except (ValueError, TypeError):
                pass
            self.script = None
        if tag == "title":
            self.in_title = False
        if tag == "h1":
            self.in_heading = False

    def handle_data(self, data):
        if self.script is not None:
            self.script += data
        if self.in_title:
            self.title += data
        if self.in_heading:
            self.heading += data


def json_nodes(value):
    if isinstance(value, dict):
        yield value
        # Only descend into graph/mainEntity; never take a related venue's point.
        for key in ("@graph", "mainEntity", "mainEntityOfPage"):
            if key in value:
                yield from json_nodes(value[key])
    elif isinstance(value, list):
        for item in value:
            yield from json_nodes(item)


def float_pair(latitude, longitude):
    try:
        latitude, longitude = float(latitude), float(longitude)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        return None
    # US states including Alaska and Hawaii, excluding zero/default world points.
    if (18 <= latitude <= 72 and -180 <= longitude <= -65) or (50 <= latitude <= 72 and 170 <= longitude <= 180):
        return latitude, longitude
    return None


def extract(content, final_url):
    page = Page(content)
    points = []
    addresses = []
    match = re.search(r'<div[^>]+class=["\'][^"\']*attraction-address[^"\']*["\'][^>]*>(.*?)</div>', content, re.I | re.S)
    if match:
        address = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", match.group(1)))).strip()
        if address:
            addresses.append({"address": address, "method": "attraction-address"})
    for script in page.scripts:
        for item in json_nodes(script):
            address = item.get("address")
            if isinstance(address, dict) and address.get("streetAddress"):
                addresses.append({"address": address, "method": "json-ld:address"})
            geo = item.get("geo")
            if isinstance(geo, dict):
                pair = float_pair(geo.get("latitude"), geo.get("longitude"))
                if pair:
                    points.append({"latitude": pair[0], "longitude": pair[1], "name": item.get("name", ""), "address": item.get("address", {}), "method": "json-ld:geo", "entityUrl": item.get("url")})
    pair = float_pair(page.meta.get("place:location:latitude") or page.meta.get("latitude"), page.meta.get("place:location:longitude") or page.meta.get("longitude"))
    if pair:
        address = ""
        match = re.search(r'<div[^>]+class=["\'][^"\']*attraction-address[^"\']*["\'][^>]*>(.*?)</div>', content, re.I | re.S)
        if match:
            address = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", match.group(1)))).strip()
        points.append({"latitude": pair[0], "longitude": pair[1], "name": page.heading.strip() or page.meta.get("og:title") or page.title, "address": address, "method": "meta:geographic-coordinate", "entityUrl": final_url})
    unique = {}
    for point in points:
        key = (round(point["latitude"], 5), round(point["longitude"], 5))
        if key not in unique or point["method"].startswith("json"):
            unique[key] = point
    return {"title": page.title.strip(), "heading": page.heading.strip(), "points": list(unique.values()), "addressCandidates": addresses}


def identity_check(record, point, page):
    names = [record["name"], *record.get("aliases", [])]
    candidates = [point.get("name", ""), page.get("heading", ""), page.get("title", "")]
    matches = []
    for name in names:
        expected = normalized(name)
        all_tokens = set(expected.split())
        significant = all_tokens - STOPWORDS
        for candidate in candidates:
            actual = normalized(candidate)
            tokens = set(actual.split())
            distinctive_overlap = significant & tokens
            containment = len(expected) >= 5 and (expected in actual or (len(actual) >= 5 and actual in expected))
            token_match = len(all_tokens & tokens) / max(1, min(len(all_tokens), len(tokens))) >= (2 / 3) and bool(distinctive_overlap)
            # One-token identities need the exact distinctive token, not substring.
            if containment or token_match:
                matches.append({"expected": name, "sourceName": candidate, "matchedTokens": sorted(distinctive_overlap)})
    address = point.get("address")
    source_region = address.get("addressRegion", "") if isinstance(address, dict) else ""
    source_locality = address.get("addressLocality", "") if isinstance(address, dict) else ""
    region = STATES.get(str(source_region).upper(), source_region)
    region_conflict = bool(region and normalized(region) != normalized(record["state"]))
    if isinstance(address, str):
        # Regional hauntedhouse pages have a single attraction-address block.
        match = re.search(r",\s*([A-Z]{2})(?:\s+\d{5}|\s*$)", address)
        if match and match.group(1) in STATES:
            region = STATES[match.group(1)]
            region_conflict = region != record["state"]
    source_city = normalized(source_locality)
    expected_city = normalized(record.get("city", ""))
    locality_conflict = bool(source_city and expected_city and source_city != expected_city and source_city not in expected_city and expected_city not in source_city)
    street_address = normalized(address.get("streetAddress", "")) if isinstance(address, dict) else normalized(address)
    locality_supported_by_street_address = bool(expected_city and re.search(r"(?:^| )" + re.escape(expected_city) + r"(?: |$)", street_address))
    unresolved_locality_conflict = locality_conflict and not locality_supported_by_street_address
    # State must be supported by the entity address, regional site or page title.
    title = normalized(page.get("title", ""))
    state_support = bool(region and not region_conflict) or normalized(record["state"]) in title
    if not state_support:
        # Hauntedplaces titles terminate "- City, ST | Haunted Places".
        code = STATE_CODES.get(record["state"], "")
        state_support = bool(code and re.search(r",\s*" + re.escape(code) + r"(?:\s|\||$)", page.get("title", "")))
    bounds = STATE_BOUNDS.get(record["state"])
    latitude, longitude = point["latitude"], point["longitude"]
    bounds_longitude = longitude
    coordinate_in_state_bounds = bool(bounds and bounds[0] - 0.15 <= bounds_longitude <= bounds[2] + 0.15 and bounds[1] - 0.15 <= latitude <= bounds[3] + 0.15)
    return {"coordinateInStateBounds": coordinate_in_state_bounds, "nameMatches": matches[:3], "sourceRegion": region, "sourceLocality": source_locality, "stateSupported": state_support, "regionConflict": region_conflict, "localityConflict": locality_conflict, "localitySupportedByStreetAddress": locality_supported_by_street_address, "valid": bool(matches and state_support and coordinate_in_state_bounds and not region_conflict and not unresolved_locality_conflict)}


class Collector:
    def __init__(self, directory, retry_failures=False):
        self.directory = directory
        self.retry_failures = retry_failures
        self.cache = directory / "source-cache"
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.Lock()
        self.host_locks = {}
        self.host_semaphores = {}
        self.host_next = {}

    def fetch(self, url):
        key = hashlib.sha256(url.encode()).hexdigest()
        path = self.cache / (key + ".json")
        if path.exists():
            previous = json.loads(path.read_text())
            if previous.get("ok"):
                raw_path = self.cache / previous["htmlFile"]
                with gzip.open(raw_path, "rb") as handle:
                    raw = handle.read()
                if hashlib.sha256(raw).hexdigest() != previous["sha256"]:
                    raise ValueError(f"Cached source bytes changed: {url}")
                previous["page"] = extract(raw.decode("utf-8", "replace"), previous["finalUrl"])
                save(path, previous)
                return previous
            if not self.retry_failures:
                return previous
        host = urllib.parse.urlsplit(url).netloc
        with self.lock:
            lock = self.host_locks.setdefault(host, threading.Lock())
            semaphore = self.host_semaphores.setdefault(host, threading.Semaphore(2))
        result = {"url": url, "retrievedAt": utcnow(), "ok": False, "version": VERSION}
        with semaphore:
            for attempt in range(3):
                with lock:
                    delay = self.host_next.get(host, 0) - time.monotonic()
                    if delay > 0:
                        time.sleep(delay)
                    self.host_next[host] = time.monotonic() + 0.55
                try:
                    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; PHASMResearch/1.0; source-coordinate-verification)", "Accept": "text/html,application/xhtml+xml", "Accept-Encoding": "gzip"})
                    with urllib.request.urlopen(request, timeout=25) as response:
                        raw = response.read(4_000_001)
                        if len(raw) > 4_000_000:
                            raise ValueError("Response exceeds 4MB safety limit")
                        if response.headers.get("Content-Encoding") == "gzip":
                            raw = gzip.decompress(raw)
                        content = raw.decode("utf-8", "replace")
                        result.update({"ok": True, "httpStatus": response.status, "finalUrl": response.url, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "page": extract(content, response.url), "htmlFile": key + ".html.gz"})
                        with gzip.open(self.cache / result["htmlFile"], "wb") as handle:
                            handle.write(raw)
                        (self.cache / result["htmlFile"]).chmod(0o600)
                        break
                except urllib.error.HTTPError as error:
                    result.update({"httpStatus": error.code, "error": str(error)})
                    # Never retry access-denied pages or attempt access workarounds.
                    if error.code not in (408, 429, 500, 502, 503, 504):
                        break
                    if attempt < 2:
                        time.sleep(min(15, 3 * (attempt + 1)))
                except (OSError, ValueError) as error:
                    result["error"] = str(error)
                    if attempt < 2:
                        time.sleep(2 * (attempt + 1))
        save(path, result)
        return result


def make_candidate(record, cached):
    evidence = {key: cached.get(key) for key in ("url", "finalUrl", "retrievedAt", "sha256", "httpStatus", "error") if cached.get(key) is not None}
    if not cached.get("ok"):
        return {"status": "source-unavailable", "evidence": evidence}
    page = cached["page"]
    if len(page["points"]) != 1:
        return {"status": "missing-coordinate" if not page["points"] else "ambiguous-coordinate", "evidence": {**evidence, "pageTitle": page["title"], "sourceName": page["heading"]}, "points": page["points"], "addressCandidates": page.get("addressCandidates", [])}
    point = page["points"][0]
    identity = identity_check(record, point, page)
    candidate = {"status": "accepted" if identity["valid"] else "identity-review", "latitude": point["latitude"], "longitude": point["longitude"], "coordinatePrecision": "approximate", "coordinateReference": {"scope": "site", "label": f"Source-reported approximate location of {record['name']}", "sourceUrl": cached["url"]}, "evidence": {**evidence, "method": point["method"], "pageTitle": page["title"], "sourceName": point["name"], "sourceAddress": point["address"], "identity": identity}}
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, help="Optional frozen provider audit; every URL is rechecked against the catalog bibliography")
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--records", type=Path, help="Optional original research sidecar with aliases")
    parser.add_argument("--retry-failures", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    baseline = sqlite3.connect(f"file:{args.catalog}?mode=ro", uri=True)
    missing = {row[0] for row in baseline.execute("SELECT id FROM locations WHERE latitude IS NULL AND longitude IS NULL")}
    catalog = {row[0]: json.loads(row[1]) for row in baseline.execute("SELECT id, data_json FROM locations")}
    records = []
    audit = json.loads(args.audit.read_text()) if args.audit else None
    audit_records = {r["id"]: r for r in audit["records"]} if audit else None
    for identity in sorted(missing):
        item = catalog[identity]
        cited = {source["url"] for source in item.get("sources", [])}
        providers = {}
        for url in sorted(cited):
            parsed = urllib.parse.urlsplit(url)
            host, path = parsed.netloc, parsed.path
            provider = "hauntedplaces" if host in ("www.hauntedplaces.org", "hauntedplaces.org") and path.startswith("/item/") else "hauntedhouses" if host.endswith("hauntedhouses.com") and path.startswith("/real-haunt/") else "hauntbound" if host in ("www.hauntbound.com", "hauntbound.com") and path.startswith("/locations/") else None
            if provider:
                providers.setdefault(provider, []).append(url)
        if audit_records is not None:
            frozen = audit_records.get(identity, {}).get("providers", {})
            for provider, urls in frozen.items():
                if any(url not in cited for url in urls):
                    raise ValueError(f"Audit includes an uncited source for {identity}")
            providers = {provider: [url for url in urls if url in providers.get(provider, [])] for provider, urls in frozen.items()}
            providers = {provider: urls for provider, urls in providers.items() if urls}
        if providers:
            records.append({"id": identity, "name": item["name"], "city": item["city"], "state": item["state"], "providers": providers})
    if args.limit:
        records = records[:args.limit]
    if args.records:
        sidecars = {r["appId"]: r for r in json.loads(args.records.read_text())}
        for record in records:
            sidecar = sidecars.get(record["id"], {}).get("sidecar", {})
            aliases = sidecar.get("index", {}).get("aliases", [])
            record["aliases"] = [a for a in aliases if isinstance(a, str)]
    collector = Collector(args.directory, args.retry_failures)
    output = {}
    pending = {}
    for record in records:
        urls = []
        for provider in ("hauntedplaces", "hauntedhouses", "hauntbound"):
            urls.extend(record["providers"].get(provider, []))
        pending[record["id"]] = list(dict.fromkeys(urls))
        output[record["id"]] = {"id": record["id"], "name": record["name"], "city": record["city"], "state": record["state"], "status": "pending", "attempts": []}
    by_id = {r["id"]: r for r in records}
    started = utcnow()
    collector_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    input_sha256 = hashlib.sha256(json.dumps(records, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

    def checkpoint():
        counts = {}
        for result in output.values():
            counts[result["status"]] = counts.get(result["status"], 0) + 1
        summary = {"version": VERSION, "collectorSha256": collector_sha256, "inputSha256": input_sha256, "startedAt": started, "updatedAt": utcnow(), "records": len(records), "statuses": counts, "existingMappedRecordsPreserved": baseline.execute("SELECT count(*) FROM locations WHERE latitude IS NOT NULL").fetchone()[0]}
        save(args.directory / "source-progress.json", summary)
        save(args.directory / "source-candidates.json", {"summary": summary, "records": list(output.values())})
        print(json.dumps(summary), flush=True)

    checkpoint()
    while True:
        jobs = {}
        for identity, urls in pending.items():
            if output[identity]["status"] != "accepted" and urls:
                jobs.setdefault(urls.pop(0), []).append(identity)
        if not jobs:
            break
        # Interleave hosts so one site's polite queue does not starve other sites.
        hosts = {}
        for url in jobs:
            hosts.setdefault(urllib.parse.urlsplit(url).netloc, []).append(url)
        ordered = []
        while any(hosts.values()):
            for values in hosts.values():
                if values:
                    ordered.append(values.pop(0))
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(collector.fetch, url): url for url in ordered}
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                url = futures[future]
                try:
                    cached = future.result()
                except Exception as error:
                    cached = {"ok": False, "url": url, "error": str(error)}
                for identity in jobs[url]:
                    candidate = make_candidate(by_id[identity], cached)
                    output[identity]["attempts"].append(candidate)
                    if candidate["status"] == "accepted":
                        output[identity].update({key: value for key, value in candidate.items() if key != "evidence"})
                        output[identity]["evidence"] = candidate["evidence"]
                    else:
                        output[identity]["status"] = candidate["status"]
                completed += 1
                if completed % 25 == 0:
                    checkpoint()
    checkpoint()


if __name__ == "__main__":
    main()
