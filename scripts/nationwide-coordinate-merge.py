#!/usr/bin/env python3
"""Freeze an auditable coordinate-only catalog from cached geographic evidence.

No networking or database writes. A normal run requires complete source collection
and a reference for every missing point. --preview produces an explicit incomplete
review packet that must never be published.
"""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import urlsplit

VERSION = "phasm-coordinate-merge-1"
GEO_FIELDS = {"latitude", "longitude", "coordinatePrecision", "coordinateReference"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def distance(a, b):
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat = lat2 - lat1
    dlon = math.radians(b["longitude"] - a["longitude"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def validate_point(point):
    latitude, longitude = point.get("latitude"), point.get("longitude")
    if any(isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) for x in [latitude, longitude]):
        raise ValueError("Coordinates must be finite numbers")
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or (latitude == 0 and longitude == 0):
        raise ValueError("Invalid coordinate range")
    if point.get("coordinatePrecision") != "approximate":
        raise ValueError("Enrichment references must be explicitly approximate")
    reference = point.get("coordinateReference", {})
    if set(reference) != {"scope", "label", "sourceUrl"}:
        raise ValueError("Incomplete coordinate reference")
    if reference["scope"] not in {"site", "locality", "county", "state"}:
        raise ValueError("Unknown reference scope")
    if not isinstance(reference["label"], str) or not reference["label"].strip():
        raise ValueError("Missing reference label")
    url = urlsplit(reference["sourceUrl"])
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("Reference must link to a public HTTPS source")
    if not point.get("evidence"):
        raise ValueError("Missing coordinate evidence")


def merge(catalog, sources, addresses, localities, overrides=None):
    originals = {x["id"]: x for x in catalog}
    if len(originals) != len(catalog):
        raise ValueError("Duplicate catalog IDs")
    direct = {x["id"]: x for x in sources["records"] if x["status"] == "accepted"}
    address_points = {}
    address_conflicts = set()
    for packet in addresses:
        for identity, point in packet["records"].items():
            validate_point(point)
            if identity in address_points and distance(point, address_points[identity]) > 3:
                address_conflicts.add(identity)
            else:
                address_points.setdefault(identity, point)
    areas = localities["byLocationId"]
    overrides = overrides or {}
    for group in [direct, address_points, areas, overrides]:
        for identity, point in group.items():
            if identity not in originals:
                raise ValueError(f"Unknown candidate identity: {identity}")
            validate_point(point)
    choices, missing, warnings, after = [], [], [], []
    for old in catalog:
        identity = old["id"]
        if old["latitude"] is not None:
            after.append(old)
            continue
        if old["longitude"] is not None or old["coordinatePrecision"] != "withheld":
            raise ValueError(f"Inconsistent baseline coordinates: {identity}")
        site = direct.get(identity)
        address = None if identity in address_conflicts else address_points.get(identity)
        area = areas.get(identity)
        options = [("reviewed-override", overrides.get(identity)), ("source-map", site), ("street-address", address), ("area-reference", area)]
        # Conflicting source/address sites are not silently resolved as an exact
        # location. Keep the place represented by its documented area for review.
        conflict = bool(site and address and distance(site, address) > 10)
        if conflict:
            warnings.append({"id": identity, "reason": "source/address points differ by over 10 km", "distanceKm": round(distance(site, address), 2)})
            if not overrides.get(identity) and area:
                options = [("area-reference-conflict", area)]
        if identity in address_conflicts:
            warnings.append({"id": identity, "reason": "independent address matches conflict by over 3 km"})
        method, selected = next(((m, p) for m, p in options if p is not None), (None, None))
        if selected is None:
            missing.append({"id": identity, "name": old["name"], "city": old["city"], "state": old["state"]})
            after.append(old)
            continue
        next_location = {**old, **{key: selected[key] for key in GEO_FIELDS}}
        if {k: v for k, v in old.items() if k not in GEO_FIELDS} != {k: v for k, v in next_location.items() if k not in GEO_FIELDS}:
            raise ValueError(f"Unexpected non-geographic change: {identity}")
        after.append(next_location)
        choices.append({"id": identity, "method": method, "reference": {key: selected[key] for key in GEO_FIELDS}, "evidence": selected["evidence"]})
        if area and selected["coordinateReference"]["scope"] == "site":
            gap = distance(selected, area)
            threshold = 250 if old["state"] == "Alaska" else 100
            if gap > threshold:
                warnings.append({"id": identity, "reason": "site is far from named locality representative point", "distanceKm": round(gap, 2)})
    return after, choices, missing, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--sources", required=True)
    parser.add_argument("--addresses", action="append", default=[])
    parser.add_argument("--localities", required=True)
    parser.add_argument("--overrides")
    parser.add_argument("--output", required=True)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise ValueError("Output exists; retain its frozen packet and choose a new path")
    catalog, sources, localities = load(args.catalog), load(args.sources), load(args.localities)
    addresses = [load(path) for path in args.addresses]
    overrides = load(args.overrides) if args.overrides else {}
    pending = sources["summary"]["statuses"].get("pending", 0)
    if pending and not args.preview:
        raise ValueError("Source collection is unfinished")
    after, choices, missing, warnings = merge(catalog, sources, addresses, localities, overrides)
    if missing and not args.preview:
        raise ValueError(f"{len(missing)} locations still lack a supported reference")
    input_hash = digest({"version": VERSION, "before": catalog, "choices": choices})
    report = {
        "version": VERSION, "inputHash": input_hash, "beforeHash": digest(catalog),
        "afterHash": digest(after), "publishable": not args.preview and not missing and not pending,
        "catalogCount": len(after), "preservedMapped": sum(x["latitude"] is not None for x in catalog),
        "updated": len(choices), "mappedAfter": sum(x["latitude"] is not None for x in after),
        "methodCounts": dict(collections.Counter(x["method"] for x in choices)),
        "referenceCounts": dict(collections.Counter(x["reference"]["coordinateReference"]["scope"] for x in choices)),
        "sourceCollectionPending": pending, "missing": missing, "warnings": warnings,
        "evidenceAttribution": localities.get("attribution", {}),
    }
    output.mkdir(parents=True, mode=0o700)
    for name, value in [("catalog.json", after), ("decisions.json", choices), ("report.json", report)]:
        path = output / name
        path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
        path.chmod(0o600)
    print(json.dumps({k: v for k, v in report.items() if k not in {"missing", "warnings", "evidenceAttribution"}}, indent=2))


if __name__ == "__main__":
    main()
