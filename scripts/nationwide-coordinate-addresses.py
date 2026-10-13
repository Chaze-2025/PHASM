#!/usr/bin/env python3
"""Repeatable, cached US Census street-address coordinate candidate enrichment.

Writes candidate/evidence files only; it never changes a catalog or live site.
Only exact Census address matches are accepted and every result is approximate:
Census TIGER street ranges are an address reference, not a verified entrance.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = "phasm-census-street-addresses-1"
ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BENCHMARK = "Public_AR_Current"
STATE_CODES = dict(zip(
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming".split("|"),
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
))


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def address_parts(record):
    """Extract only a numbered street address tied to the supplied city/state."""
    raw = record.get("rawAddress")
    state = STATE_CODES.get(record.get("state"))
    if isinstance(raw, dict):
        region = raw.get("addressRegion")
        country = raw.get("addressCountry")
        if region and region not in [state, record.get("state")]:
            return None, "address_state_mismatch"
        if country and country not in ["US", "USA", "United States"]:
            return None, "address_country_mismatch"
        # Provider streetAddress often already contains the complete address;
        # its addressLocality may describe a nearby larger postal town. Preserve
        # the complete street string and independently compare the record city.
        raw = raw.get("streetAddress")
    if not isinstance(raw, str) or not raw.strip():
        return None, "no_address"
    if not state or f"phasm-us-{state.lower()}-" not in record["id"]:
        return None, "state_identity_mismatch"
    city = record.get("city", "").strip()
    if not city or re.search(r"\b(?:unknown|various|statewide)\b", city, re.I):
        return None, "no_specific_city"
    address = " ".join(raw.replace("\u200e", "").replace("’", "'").split())
    # These are explicit house numbers, not inferred locations.
    address = re.sub(r"^One\s+", "1 ", address, flags=re.I)
    address = re.sub(r"^Lower level,\s*", "", address, flags=re.I)
    if not re.match(r"^\d+[A-Za-z]?(?:-\d+)?\s+", address):
        return None, "no_numbered_street_address"
    postal = ""
    postal_match = re.search(r"\s+(\d{5}(?:-\d{4})?)\s*$", address)
    if postal_match:
        postal = postal_match[1]
        address = address[:postal_match.start()].rstrip(" ,")
    expected_suffix = rf"(?:,\s*|\s+)(?:{re.escape(record['state'])}|{state})$"
    had_state = bool(re.search(expected_suffix, address, re.I))
    address = re.sub(expected_suffix, "", address, flags=re.I).rstrip(" ,")
    # An explicit contradictory state must never be silently overwritten.
    if not had_state and re.search(r",\s*(?:" + "|".join(STATE_CODES.values()) + ")$", address, re.I):
        return None, "address_state_mismatch"
    # Parentheses in supplied data describe routing/parking, never location identity.
    address = re.sub(r"\s*\([^)]*\)", "", address).strip(" ,")
    chunks = [part.strip() for part in address.split(",") if part.strip()]
    if len(chunks) > 1:
        supplied_city = chunks[-1]
        if normalized(supplied_city) != normalized(city):
            return None, "address_city_mismatch"
        street = ", ".join(chunks[:-1])
    else:
        city_match = re.search(r"\s+" + re.escape(city) + "$", address, re.I)
        if city_match:
            street = address[:city_match.start()].strip(" ,")
        elif had_state:
            return None, "cannot_separate_street_city"
        else:
            street = address
    if "," in street or not re.match(r"^\d+[A-Za-z]?(?:-\d+)?\s+\S", street):
        return None, "ambiguous_street_address"
    if re.search(r"\b(?:mile marker|po box|p\.o\.|intersection|near|and|or)\b|[;&]", street, re.I):
        return None, "ambiguous_street_address"
    return {"id": record["id"], "street": street, "city": city, "state": state, "zip": postal}, None


def us_coordinate(latitude, longitude, state):
    if not all(math.isfinite(v) for v in [latitude, longitude]):
        return False
    if state == "AK":
        return 51 <= latitude <= 72 and (-180 <= longitude <= -129 or 170 <= longitude <= 180)
    if state == "HI":
        return 18 <= latitude <= 29 and -179 <= longitude <= -154
    return 24 <= latitude <= 50 and -125 <= longitude <= -66


def parse_match(row, part):
    if len(row) < 4 or row[2:4] != ["Match", "Exact"]:
        return None, "census_no_exact_match"
    if len(row) < 8:
        return None, "census_malformed_exact_match"
    if row[0] != part["id"]:
        return None, "census_id_mismatch"
    components = [value.strip() for value in row[4].split(",")]
    if len(components) < 4 or components[-2] != part["state"]:
        return None, "census_state_mismatch"
    # Match exact is provider evidence of the street and city/ZIP supplied, but
    # independently require the numbered street to remain the same identity.
    requested_number = re.match(r"^(\d+[A-Za-z]?(?:-\d+)?)\b", part["street"])
    matched_number = re.match(r"^(\d+[A-Za-z]?(?:-\d+)?)\b", components[0])
    if not requested_number or not matched_number or requested_number[1].lower() != matched_number[1].lower():
        return None, "census_house_number_mismatch"
    # Postal-city aliases may differ but require matching supplied ZIP in that case.
    if normalized(components[-3]) != normalized(part["city"]) and not (
        part["zip"] and components[-1][:5] == part["zip"][:5]
    ):
        return None, "census_city_mismatch"
    try:
        longitude, latitude = [float(value) for value in row[5].split(",")]
    except (ValueError, TypeError):
        return None, "census_invalid_coordinates"
    if not us_coordinate(latitude, longitude, part["state"]):
        return None, "census_coordinates_outside_us"
    return {"latitude": latitude, "longitude": longitude, "matchedAddress": row[4], "tigerLineId": row[6], "tigerLineSide": row[7]}, None


def csv_request(parts):
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\n")
    for part in parts:
        writer.writerow([part[key] for key in ["id", "street", "city", "state", "zip"]])
    return output.getvalue().encode()


def fetch_batch(request, response_path):
    boundary = "----PhasmCensus" + sha(request)[:32]
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\n{BENCHMARK}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="addressFile"; filename="addresses.csv"\r\nContent-Type: text/csv\r\n\r\n'
    ).encode() + request + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "User-Agent": "PHASM research coordinate importer / Census public geocoder",
    })
    with urllib.request.urlopen(req, timeout=180) as response:
        if response.status != 200:
            raise ValueError(f"Census returned HTTP {response.status}")
        result = response.read()
    # Never persist an error page as a reusable geocoder response.
    rows = [row for row in csv.reader(io.StringIO(result.decode())) if row]
    if not rows or any(len(row) < 3 for row in rows):
        raise ValueError("Census did not return a valid batch CSV")
    response_path.write_bytes(result)
    return result


def self_test():
    record = {"id": "phasm-us-al-test", "state": "Alabama", "city": "Albertville", "rawAddress": "220 Jackson St Albertville, AL 35950"}
    part, error = address_parts(record)
    assert not error and part == {"id": record["id"], "street": "220 Jackson St", "city": "Albertville", "state": "AL", "zip": "35950"}
    exact = [record["id"], "request", "Match", "Exact", "220 JACKSON ST, ALBERTVILLE, AL, 35950", "-86.203205510895,34.264314737007", "99231434", "R"]
    match, error = parse_match(exact, part)
    assert not error and match["latitude"] > 34 and match["longitude"] < -86
    for field, value, expected in [(3, "Non_Exact", "census_no_exact_match"), (4, "220 JACKSON ST, ALBERTVILLE, NY, 35950", "census_state_mismatch"), (4, "222 JACKSON ST, ALBERTVILLE, AL, 35950", "census_house_number_mismatch"), (5, "2,2", "census_coordinates_outside_us")]:
        row = exact.copy()
        row[field] = value
        assert parse_match(row, part)[1] == expected
    assert address_parts({**record, "rawAddress": "Jackson St, Albertville, AL"})[1] == "no_numbered_street_address"
    assert address_parts({**record, "rawAddress": "220 Jackson St, Wrongtown, AL"})[1] == "address_city_mismatch"
    assert address_parts({**record, "rawAddress": "220 Jackson St, Albertville, NY"})[1] == "address_state_mismatch"
    assert address_parts({**record, "rawAddress": "One Jackson St, Albertville, AL"})[0]["street"] == "1 Jackson St"
    assert address_parts({**record, "rawAddress": {"streetAddress": record["rawAddress"], "addressRegion": "Alabama", "addressCountry": "US"}})[0] == part
    assert address_parts({**record, "rawAddress": {"streetAddress": record["rawAddress"], "addressRegion": "New York"}})[1] == "address_state_mismatch"
    print("Address parser and Census exact-match rejection tests passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("/workspace/phasm-pin-enrichment/source-audit.json"))
    parser.add_argument("--output", type=Path, default=Path("/workspace/phasm-pin-enrichment/addresses"))
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--exclusions", type=Path, help="Reviewed address-identity conflicts; retained in output for repeatable exclusion")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not 1 <= args.batch_size <= 10000:
        raise ValueError("Batch size must be 1–10,000 addresses")
    input_bytes = args.input.read_bytes()
    source = json.loads(input_bytes)
    records = {record["id"]: record for record in source["records"]}
    if len(records) != len(source["records"]):
        raise ValueError("Duplicate source IDs")
    args.output.mkdir(parents=True, exist_ok=True)
    exclusion_path = args.exclusions or args.output / "exclusions.json"
    exclusions = {}
    if exclusion_path.exists():
        exclusions_document = json.loads(exclusion_path.read_text())
        if exclusions_document.get("version") != "phasm-address-exclusions-1":
            raise ValueError("Unsupported address exclusion receipt")
        exclusions = exclusions_document["records"]
        if not isinstance(exclusions, dict) or any(not item.get("reason") or not item.get("sourceUrl") for item in exclusions.values()):
            raise ValueError("Each excluded address needs a reason and evidence source")
        retained_path = args.output / "exclusions.json"
        if args.exclusions and retained_path.exists() and json.loads(retained_path.read_text()) != exclusions_document:
            raise ValueError("Existing exclusion receipt differs; use a new output directory")
        if args.exclusions:
            retained_path.write_text(json.dumps(exclusions_document, indent=2) + "\n")
    parts = []
    rejected = []
    for record in sorted(records.values(), key=lambda value: value["id"]):
        part, error = address_parts(record)
        if error:
            if record.get("rawAddress"):
                rejected.append({"id": record["id"], "reason": error, "rawAddress": record["rawAddress"]})
        else:
            parts.append(part)
    if args.limit:
        parts = parts[:args.limit]
    args.output.mkdir(parents=True, exist_ok=True)
    cache = args.output / "cache"
    cache.mkdir(exist_ok=True)
    accepted = {}
    batches = []
    input_fingerprint = sha(canonical({"version": VERSION, "benchmark": BENCHMARK, "addresses": parts, **({"exclusions": exclusions} if exclusions else {})}))
    for start in range(0, len(parts), args.batch_size):
        batch = parts[start:start + args.batch_size]
        request = csv_request(batch)
        request_hash = sha(request)
        request_path = cache / f"{request_hash}.request.csv"
        response_path = cache / f"{request_hash}.response.csv"
        metadata_path = cache / f"{request_hash}.json"
        if request_path.exists() and request_path.read_bytes() != request:
            raise ValueError("Cached request hash mismatch")
        request_path.write_bytes(request)
        if response_path.exists():
            if not metadata_path.exists():
                raise ValueError("Cached response has no integrity receipt")
            response = response_path.read_bytes()
            prior = json.loads(metadata_path.read_text())
            if prior["responseSha256"] != sha(response) or prior["requestSha256"] != request_hash:
                raise ValueError("Cached response hash mismatch")
            if prior.get("endpoint") != ENDPOINT or prior.get("benchmark") != BENCHMARK:
                raise ValueError("Cached response provider/benchmark mismatch")
        else:
            print(f"Fetching Census batch {start // args.batch_size + 1}: {len(batch)} addresses", flush=True)
            response = fetch_batch(request, response_path)
        receipt = {"endpoint": ENDPOINT, "benchmark": BENCHMARK, "requestSha256": request_hash, "responseSha256": sha(response), "addressCount": len(batch), "requestFile": str(request_path), "responseFile": str(response_path)}
        metadata_path.write_text(json.dumps(receipt, indent=2) + "\n")
        batches.append(receipt)
        response_rows = [row for row in csv.reader(io.StringIO(response.decode())) if row]
        by_id = {row[0]: row for row in response_rows}
        if len(by_id) != len(response_rows) or set(by_id) != {part["id"] for part in batch}:
            raise ValueError("Census response IDs do not match request exactly")
        for part in batch:
            row = by_id[part["id"]]
            record = records[part["id"]]
            if record["id"] in exclusions:
                rejected.append({"id": record["id"], "reason": "reviewed_address_identity_conflict", "rawAddress": record.get("rawAddress"), "exclusion": exclusions[record["id"]]})
                continue
            result, error = parse_match(row, part)
            if error:
                rejected.append({"id": part["id"], "reason": error, "rawAddress": record["rawAddress"], "response": row})
                continue
            query_address = ", ".join([part["street"], part["city"], part["state"] + (" " + part["zip"] if part["zip"] else "")])
            source_url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode({"address": query_address, "benchmark": BENCHMARK, "format": "json"})
            accepted[part["id"]] = {
                "id": part["id"], "name": record["name"],
                "latitude": result["latitude"], "longitude": result["longitude"], "coordinatePrecision": "approximate",
                "coordinateReference": {"scope": "site", "label": "Street-address reference: " + result["matchedAddress"], "sourceUrl": source_url},
                "method": "census-exact-street-address-interpolation", "evidence": {
                    "rawAddress": record["rawAddress"], "submittedAddress": part, "matchedAddress": result["matchedAddress"],
                    "matchStatus": row[2], "matchType": row[3], "tigerLineId": result["tigerLineId"], "tigerLineSide": result["tigerLineSide"],
                    "sources": record.get("sources", []), "providerUrls": record.get("providers", {}),
                    **({"sourcePage": {key: record[key] for key in ["sourceUrl", "sourceName", "sourceMethod", "sha256"] if key in record}} if "sourceUrl" in record else {}),
                    "requestSha256": request_hash, "responseSha256": sha(response), "responseFile": str(response_path),
                    "caveat": "Census TIGER street-range interpolation; approximate address reference, not a verified entrance or permission to enter.",
                },
            }
        print(f"Processed {min(start + args.batch_size, len(parts))}/{len(parts)} addresses; accepted {len(accepted)}", flush=True)
    output = {"version": VERSION, "inputSha256": sha(input_bytes), "inputFingerprint": input_fingerprint, **({"exclusionsSha256": sha(canonical(exclusions))} if exclusions else {}), "benchmark": BENCHMARK, "summary": {"inputRecords": len(records), "rawAddresses": sum(bool(record.get("rawAddress")) for record in records.values()), "submitted": len(parts), "accepted": len(accepted), "rejectedWithAddresses": len(rejected)}, "records": accepted, "rejected": rejected, "batches": batches}
    destination = args.output / "candidates.json"
    destination.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(destination), **output["summary"]}, indent=2))


if __name__ == "__main__":
    main()
