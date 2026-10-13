#!/usr/bin/env python3
"""Resolve honest area markers from frozen public gazetteers, without geocoding APIs.

This produces a review artifact, never updates the catalog or a remote database.
All matches are name + state matches; ambiguity is retained for manual review.
Census internal points and GeoNames populated-place/area coordinates are NOT
building positions. Consumers must preserve coordinateReference and attribution.
"""

import argparse
import csv
import hashlib
import io
import json
import math
import re
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

VERSION = "phasm-locality-gazetteer-1"
DATASETS = {
    "census-2025-places": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip",
    "census-2025-cousubs": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_cousubs_national.zip",
    "census-2025-counties": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip",
    "census-2025-state": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_state_national.zip",
    "geonames-us": "https://download.geonames.org/export/dump/US.zip",
}
STATE_NAMES = dict(pair.split(":", 1) for pair in (
    "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia|PR:Puerto Rico"
).split("|"))
SUFFIX = re.compile(r" (?:city and borough|city and county|consolidated government|metropolitan government|unified government|urban county|municipality|CDP|city|town|village|borough|township|plantation|CCD|UT)$", re.I)


def normalized(value):
    value = unicodedata.normalize("NFKD", value.lower()).encode("ascii", "ignore").decode()
    value = re.sub(r"\bsaint\b", "st", value)
    value = re.sub(r"\bmount\b", "mt", value)
    return re.sub(r"[^a-z0-9]", "", value)


def words(value):
    """Preserve word boundaries to distinguish Valley View from Valleyview."""
    value = unicodedata.normalize("NFKD", value.lower()).encode("ascii", "ignore").decode()
    return " ".join(re.findall(r"[a-z0-9]+", value))


def digest(path):
    return hashlib.file_digest(path.open("rb"), "sha256").hexdigest()


def distance(a, b):
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    delta_lat = lat2 - lat1
    delta_lon = math.radians(b["longitude"] - a["longitude"])
    return 6371 * 2 * math.asin(min(1, math.sqrt(math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2)))


def census_names(value):
    short = SUFFIX.sub("", value)
    # Aliases explicitly printed in Census NAME, such as San Buenaventura (Ventura).
    names = {value, short}
    if "(" in short:
        names.update(re.findall(r"\(([^)]+)\)", short))
        names.add(re.sub(r"\s*\([^)]*\)", "", short))
    return names


def build_indexes(cache, wanted, forced_ids=()):
    indexes = {kind: defaultdict(list) for kind in ("places", "cousubs", "counties", "state", "populated", "area")}
    metadata = {}
    for dataset, url in DATASETS.items():
        path = cache / f"{dataset}.zip"
        if not path.exists():
            request = urllib.request.Request(url, headers={"User-Agent": "PHASM locality enrichment/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response, path.with_suffix(".tmp").open("wb") as target:
                while block := response.read(1024 * 1024):
                    target.write(block)
            path.with_suffix(".tmp").replace(path)
        metadata[dataset] = {"url": url, "sha256": digest(path), "bytes": path.stat().st_size, "license": "CC BY 4.0" if dataset == "geonames-us" else "U.S. Census Bureau public domain"}
        archive = zipfile.ZipFile(path)
        if dataset.startswith("census"):
            kind = dataset.removeprefix("census-2025-")
            with archive.open(archive.namelist()[0]) as stream:
                for row in csv.DictReader(io.TextIOWrapper(stream), delimiter="|"):
                    state = STATE_NAMES.get(row["USPS"], row["USPS"])
                    record = {"dataset": dataset, "lookupId": row["GEOID"], "label": row["NAME"], "state": state, "latitude": float(row["INTPTLAT"]), "longitude": float(row["INTPTLONG"]), "scope": "county" if kind == "counties" else "state" if kind == "state" else "locality", "sourceUrl": url, "primaryNames": [SUFFIX.sub("", row["NAME"]), row["NAME"]]}
                    for name in census_names(row["NAME"]):
                        if normalized(name) in wanted or kind in ("state", "counties"):
                            indexes[kind][(normalized(name), state)].append(record)
        else:
            with archive.open("US.txt") as stream:
                for line in io.TextIOWrapper(stream):
                    row = line.rstrip("\n").split("\t")
                    if len(row) < 19 or (row[6] not in {"P", "A", "L", "T", "H"} and row[0] not in forced_ids):
                        continue
                    state = STATE_NAMES.get(row[10], row[10])
                    names = {row[1], row[2], *row[3].split(",")}
                    keys = {normalized(name) for name in names} & wanted
                    if row[0] in forced_ids:
                        keys.add("reviewed-id-" + row[0])
                    if not keys:
                        continue
                    kind = "populated" if row[6] == "P" else "area"
                    record = {"dataset": dataset, "lookupId": row[0], "label": row[1], "state": state, "latitude": float(row[4]), "longitude": float(row[5]), "scope": "county" if row[7] == "ADM2" else "state" if row[7] == "ADM1" else "locality", "sourceUrl": f"https://www.geonames.org/{row[0]}/", "featureCode": row[7], "population": int(row[14] or "0"), "primaryNames": [row[1], row[2]], "countyCode": row[11]}
                    for key in keys:
                        indexes[kind][(key, state)].append(record)
    return indexes, metadata


def query_variants(city):
    """Only remove explicit qualifier syntax; never fuzzy-match different names."""
    base = city.strip()
    result = [(base, "literal locality")]
    stripped = re.sub(r"^(?:near|between)\s+", "", base, flags=re.I)
    stripped = re.sub(r"\s+(?:area|vicinity|harbor)$", "", stripped, flags=re.I)
    if stripped != base:
        result.append((stripped, "explicit area/near/vicinity/harbor qualifier"))
    # Parenthetical municipality is an explicit containing locality in the input.
    match = re.fullmatch(r"(.+?)\s*\(([^)]+)\)", stripped)
    if match:
        result.append((match[1].strip(), "locality before parenthetical qualifier"))
        result.append((re.sub(r"^near\s+", "", match[2], flags=re.I), "explicit parenthetical locality"))
    # A comma-separated locality may carry a county/island qualifier.
    if "," in stripped:
        result.append((stripped.split(",", 1)[0].strip(), "locality before comma qualifier"))
    # Slash/en-dash descriptors explicitly name a wider area. Choosing a named
    # locality is an area reference only, never evidence of the building position.
    if re.search(r"/|–", stripped):
        for part in re.split(r"\s*/\s*|–", stripped):
            part = re.sub(r"\s+(?:area|vicinity)$", "", part.strip(), flags=re.I)
            result.append((part, "explicit named locality within composite area description"))
    if " near " in stripped.lower():
        result.append((re.split(r"\s+near\s+", stripped, flags=re.I)[-1], "explicit nearby locality in area description"))
    if base.lower().startswith("between ") and "," in base:
        result.append((base.rsplit(",", 1)[-1].strip(), "explicit county in between-localities description"))
    return list(dict.fromkeys(result))


def unique_candidates(rows):
    return list({(row["dataset"], row["lookupId"]): row for row in rows}.values())


def select_name(indexes, name, state):
    candidates = []
    # A populated place is a better city reference than a potentially sprawling
    # administrative subdivision (Honolulu CCD includes distant Pacific islands).
    for kind in ("places", "populated", "cousubs", "counties", "area"):
        found = unique_candidates(indexes[kind].get((normalized(name), state), []))
        primary = [row for row in found if any(words(primary) == words(name) for primary in row["primaryNames"])]
        if primary:
            found = primary
        if len(found) == 1:
            return found[0], []
        if len(found) > 1:
            # Coincident alternate entities are harmless; remote namesakes are not.
            if all(distance(found[0], other) < 1 for other in found[1:]):
                return sorted(found, key=lambda row: row["lookupId"])[0], []
            candidates.extend(found)
            # A lower-priority gazetteer cannot silently disambiguate namesakes.
            return None, unique_candidates(candidates)
    return None, []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--overrides", type=Path, help="Reviewed per-ID locality overrides with sourceUrl and reason")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    cache = args.output_dir / "cache"
    cache.mkdir(exist_ok=True)
    locations = json.loads(args.catalog.read_text())
    locations = [row for row in locations if row.get("latitude") is None or row.get("longitude") is None]
    overrides = json.loads(args.overrides.read_text()) if args.overrides else {}
    wanted = {normalized(name) for row in locations for name, _ in query_variants(row["city"])}
    wanted.update(normalized(part.strip()) for row in locations for part in re.split(r"\s*/\s*|–|\s+near\s+", row["city"], flags=re.I))
    wanted.update(normalized(item["locality"]) for item in overrides.values() if "locality" in item)
    wanted.discard("")
    forced_ids = {item["lookupId"] for item in overrides.values() if item.get("dataset") == "geonames-us"}
    indexes, datasets = build_indexes(cache, wanted, forced_ids)
    resolved, unresolved = {}, []
    for location in locations:
        state, city = location["state"], location["city"]
        selected, ambiguous, method = None, [], None
        override = overrides.get(location["id"])
        if override:
            if not override.get("sourceUrl") or not override.get("reason"):
                raise ValueError(f"Override needs sourceUrl and reason: {location['id']}")
            if "lookupId" in override:
                rows = [item for index in indexes.values() for values in index.values() for item in values if item["state"] == state and item["lookupId"] == override["lookupId"] and item["dataset"] == override["dataset"]]
                matches = unique_candidates(rows)
                if len(matches) == 1:
                    selected, method = matches[0], "reviewed gazetteer identity override"
            else:
                selected, ambiguous = select_name(indexes, override["locality"], state)
                method = "reviewed locality alias"
        else:
            for name, qualifier in query_variants(city):
                selected, found = select_name(indexes, name, state)
                ambiguous.extend(found)
                if selected:
                    method = qualifier
                    break
        if selected:
            resolved[location["id"]] = {
                "latitude": selected["latitude"], "longitude": selected["longitude"],
                "coordinatePrecision": "approximate",
                "coordinateReference": {"scope": selected["scope"], "label": selected["label"], "sourceUrl": selected["sourceUrl"]},
                "evidence": {**selected, "datasetSha256": datasets[selected["dataset"]]["sha256"], "matchMethod": method, "inputLocality": city, "inputState": state, **({"override": override} if override else {})},
            }
        else:
            unresolved.append({"id": location["id"], "name": location["name"], "city": city, "state": state, "reason": "ambiguous locality" if ambiguous else "no name and state match", "candidates": unique_candidates(ambiguous)})
    payload = {"version": VERSION, "catalogSha256": digest(args.catalog), "datasets": datasets, "counts": {"input": len(locations), "resolved": len(resolved), "unresolved": len(unresolved), "byDataset": dict(Counter(row["evidence"]["dataset"] for row in resolved.values()))}, "byLocationId": resolved, "unresolved": unresolved, "attribution": {"geonames-us": {"text": "GeoNames, CC BY 4.0", "url": "https://www.geonames.org/", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"}, "census": {"text": "U.S. Census Bureau, 2025 Gazetteer Files", "url": "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html"}}}
    (args.output_dir / "localities.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    (args.output_dir / "unresolved.json").write_text(json.dumps(unresolved, indent=2, sort_keys=True) + "\n")
    print(json.dumps(payload["counts"]))


if __name__ == "__main__":
    main()
