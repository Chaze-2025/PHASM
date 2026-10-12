import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Location } from "../shared/types";
import { validateImport } from "../scripts/import-locations";
import {
  buildNationwidePlan,
  hashValue,
  PLACEHOLDER,
  resolveJsonPointer,
  stableJson,
} from "../scripts/nationwide-adapters";

type ObjectValue = Record<string, any>;
const base = JSON.parse(
  readFileSync("content/locations.json", "utf8"),
) as Location[];
const normalRecord = (id = "phasm-us-al-example-house"): ObjectValue => ({
  research_id: id,
  name: "Example House",
  city: "Example City",
  state: "Alabama",
  category: "Historic house",
  haunting_description:
    "A local account describes footsteps in an empty upstairs room. The story does not identify their cause.",
  sources: [
    {
      source_id: "STORY",
      title: "Local reported account",
      url: "https://example.org/story",
      roles: ["story", "location"],
    },
  ],
  access: {
    status: "unknown",
    notes:
      "The current owner’s visiting rules are unconfirmed; no investigation permission is implied.",
  },
  geography: { coordinates: null, precision: "withheld" },
});
interface FixtureRow {
  raw: ObjectValue;
  state?: string;
  stateCode?: string;
  baselineId?: string;
  pointer?: string;
  canonicalId?: string;
}
function fixture(
  entries: FixtureRow[] = [{ raw: normalRecord() }],
  sourceIndex: ObjectValue[] = [],
) {
  const root = mkdtempSync(join(tmpdir(), "phasm-nationwide-adapter-"));
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  const rows = entries.map((entry, i) => {
    const state = entry.state || "Alabama",
      stateCode = entry.stateCode || "AL";
    const id = entry.raw.research_id || entry.raw.provisional_id;
    const sourceFile = `checkpoints/fixture/${state.toLowerCase().replace(/ /g, "-")}/profile-${i}.json`;
    const pointer = entry.pointer || "/records/0";
    write(
      sourceFile,
      pointer === "/a~1b/~0/0"
        ? { "a/b": { "~": [entry.raw] } }
        : { records: [entry.raw] },
    );
    return {
      research_id: id,
      name: entry.raw.identity?.name || entry.raw.name,
      city: entry.raw.identity?.locality || entry.raw.city || "",
      state,
      state_code: stateCode,
      baseline_match: Boolean(entry.baselineId),
      preserve_app_id: entry.baselineId || null,
      canonical_site_id: entry.baselineId || entry.canonicalId || id,
      source_file: sourceFile,
      record_pointer: pointer,
      coordinates_present_in_research: Boolean(
        entry.raw.coordinates || entry.raw.geography?.coordinates,
      ),
      photo_status: "missing_or_unselected",
    };
  });
  write("MANIFEST.json", {
    research_date: "2026-10-12",
    profiles: rows.length,
  });
  write("index/PROFILE_INDEX.json", rows);
  write("index/GLOBAL_ID_CROSSWALK.json", rows);
  write(
    "index/BASELINE_CROSSWALK.json",
    rows
      .filter((row) => row.baseline_match)
      .map((row) => ({
        research_record_ids: [row.research_id],
        preserve_app_id: row.preserve_app_id,
      })),
  );
  write("index/SOURCE_INDEX.json", sourceIndex);
  write("baseline/phasm_sources.json", { sources: [] });
  write("index/EDITORIAL_REVIEW_ITEMS.json", []);
  write("index/DUPLICATE_AUDIT.json", []);
  write("index/BORDER_SITE_AUDIT.json", []);
  writeFileSync(
    join(root, "CHECKSUMS.sha256"),
    "immutable fixture fingerprint\n",
  );
  return {
    root,
    rows,
    write,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("JSON pointers honor escaping, reject prototype traversal and invalid array indexes", () => {
  assert.equal(resolveJsonPointer({ "a/b": { "~": [7] } }, "/a~1b/~0/0"), 7);
  assert.throws(() => resolveJsonPointer({}, "/__proto__"), /Unresolved/);
  assert.throws(() => resolveJsonPointer({ x: [1] }, "/x/01"), /pointer/);
  assert.throws(() => resolveJsonPointer({ x: 1 }, "/x~2"), /escape/);
  assert.throws(() => resolveJsonPointer({}, "x"), /Invalid/);
});

test("flat additions are drafts with honest placeholder, unknown access, null pins and complete raw sidecar", () => {
  const raw = normalRecord();
  raw.research_notes = ["The identity in the legend is uncorroborated."];
  raw.extra_detail = { unsupported: "Preserve this research unchanged." };
  const input = fixture([{ raw, pointer: "/a~1b/~0/0" }]);
  try {
    const result = buildNationwidePlan(input.root, []),
      record = result.records[0],
      location = result.locations[0];
    assert.equal(record.disposition, "created");
    assert.equal(location.status, "draft");
    assert.equal(location.image, PLACEHOLDER);
    assert.match(location.imageAlt, /Nonphotographic/);
    assert.equal(location.latitude, null);
    assert.equal(location.longitude, null);
    assert.equal(location.coordinatePrecision, "withheld");
    assert.equal(location.access, "unknown");
    assert.equal(location.tours, "unknown");
    assert.match(location.reports, /identity in the legend is uncorroborated/);
    assert.deepEqual(record.sidecar.originalRecord, raw);
    assert.equal(location.history, "");
    assert.equal(location.classification, "local-legend");
    assert.deepEqual(
      location.sources.map((source) => source.kind),
      ["reports"],
    );
    assert.deepEqual(validateImport(result.locations), result.locations);
  } finally {
    input.close();
  }
});

test("all semantic narrative families retain complete prose without invented history", () => {
  const families = [
    { story: "Flat story, with its attribution." },
    { description: "Flat description, with its qualification." },
    { haunting_description: "Flat haunting, with its uncertainty." },
    { content: { haunting_description: "Nested haunting description." } },
    {
      content: {
        hauntings: [{ text: "First account." }, { text: "Second account." }],
      },
    },
    { content: { haunting_accounts: { text: "Nested haunting accounts." } } },
    { content: { haunting: { text: "Nested singular haunting." } } },
  ];
  const entries = families.map((family, i) => {
    const raw = normalRecord(`phasm-us-al-shape-${i}`);
    delete raw.haunting_description;
    return { raw: { ...raw, name: `Shape ${i}`, ...family } };
  });
  const input = fixture(entries);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.summary.created, families.length);
    assert.ok(
      plan.locations.every(
        (location) => location.reports && location.history === "",
      ),
    );
    assert.equal(
      plan.locations[4].reports,
      "First account.\n\nSecond account.",
    );
  } finally {
    input.close();
  }
});

test("scoped short source IDs retain claim roles across states and photo pages never become haunting evidence", () => {
  const entries = ["Alabama", "Alaska"].map((state, i) => ({
    state,
    stateCode: i ? "AK" : "AL",
    raw: {
      research_id: `phasm-us-${i ? "ak" : "al"}-scoped-house`,
      identity: { name: "Scoped House", locality: "Town" },
      content: {
        card_summary: {
          text: "A historic house with reported sounds.",
          source_ids: ["HISTORY", "SHORT"],
        },
        history: [
          { text: "An archive dates the building.", source_ids: ["HISTORY"] },
        ],
        hauntings: [
          { text: "A named writer reports sounds.", source_ids: ["SHORT"] },
        ],
        visiting: { text: "Ticketed admission only.", source_ids: ["VISIT"] },
      },
      source_ids: ["SHORT", "HISTORY", "VISIT", "PHOTO"],
      access: { status: "tour" },
    },
  }));
  const sources = entries.flatMap(({ state }) =>
    [
      ["SHORT", "reports", "local_folklore"],
      ["HISTORY", "history", "institutional_history"],
      ["VISIT", "visit", "visiting"],
      ["PHOTO", "photo", "photo_license"],
    ].map(([id, part, type]) => ({
      package: "fixture",
      state_namespace: state.toLowerCase(),
      source_id: id,
      source_url: `https://example.org/${state}/${part}`,
      original_record: {
        source_id: id,
        title: `${state} ${part}`,
        url: `https://example.org/${state}/${part}`,
        source_type: type,
      },
    })),
  );
  const input = fixture(entries, sources);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.summary.created, 2);
    for (const location of plan.locations) {
      assert.deepEqual(
        location.sources.map((source) => source.kind),
        ["history", "reports", "visiting"],
      );
      assert.ok(
        location.sources.every((source) => source.url.includes(location.state)),
      );
      assert.ok(
        !location.sources.some((source) => source.url.endsWith("/photo")),
      );
      assert.equal(location.tours, "yes");
      assert.equal(location.access, "restricted");
    }
    assert.ok(
      plan.records[0].sidecar.sourceAssociations.some(
        (association) => association.kind === "media",
      ),
    );
    assert.ok(
      !plan.records[0].sidecar.sourceAssociations.some(
        (association) =>
          association.sourceId === "HISTORY" && association.kind === "reports",
      ),
    );
  } finally {
    input.close();
  }
});

test("shared photo/story pages retain their report role while actual Commons files stay media provenance", () => {
  const raw = normalRecord();
  raw.sources[0].roles.push("photo");
  raw.sources.push({
    source_id: "PHOTO",
    title: "Example House image",
    url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    roles: ["story", "photo"],
  });
  const input = fixture([{ raw }]);
  try {
    const location = buildNationwidePlan(input.root, []).locations[0];
    assert.deepEqual(
      location.sources.map((source) => source.url),
      ["https://example.org/story"],
    );
  } finally {
    input.close();
  }
});

test("phenomenon mapping distinguishes ghost lights and ghost voices, retaining unsupported tags only in provenance", () => {
  const raw = normalRecord();
  raw.phenomenon_tags = [
    "ghost lights",
    "ghost voices",
    "apparition",
    "moving objects",
    "cold spots",
    "local curse",
  ];
  raw.access.status = "closed";
  const input = fixture([{ raw }]);
  try {
    const record = buildNationwidePlan(input.root, []).records[0];
    assert.deepEqual(record.nextLocation!.phenomena, [
      "Lights and shadows",
      "Unexplained sounds",
      "Apparitions",
      "Objects moving",
      "Unusual sensations",
    ]);
    assert.match(
      record.nextLocation!.accessNotes,
      /Research access status: closed/,
    );
    assert.ok(
      record.warnings.some(
        (warning) => warning.code === "phenomenon-retained-in-sidecar",
      ),
    );
  } finally {
    input.close();
  }
});

test("singular/plural visitor evidence remains visiting provenance without inventing an official homepage", () => {
  const raw = normalRecord();
  raw.access.source_url = "https://example.org/current-operator";
  raw.access.source_urls = [
    "https://example.org/current-operator",
    "https://example.org/access-archive",
  ];
  raw.access.visitor_information_url = "https://example.org/visit";
  raw.access.booking_urls = ["https://example.org/reservations"];
  raw.access_source_url = "https://example.org/flat-visitor-source";
  raw.access_sources = [{ url: "https://example.org/flat-object-source" }];
  const input = fixture([{ raw }]);
  try {
    const record = buildNationwidePlan(input.root, []).records[0];
    const visits = record.nextLocation!.sources.filter(
      (source) => source.kind === "visiting",
    );
    assert.equal(visits.length, 6);
    assert.equal(record.nextLocation!.officialUrl, "");
    assert.ok(
      visits.every((source) =>
        record.sidecar.sourceAssociations.some(
          (association) =>
            association.url === source.url && association.kind === "visiting",
        ),
      ),
    );
    assert.equal(
      record.nextLocation!.sources.filter((source) => source.kind === "reports")
        .length,
      1,
    );
  } finally {
    input.close();
  }
});

test("administrative centroids never become site pins, even with numeric coordinates and a source", () => {
  const meanings = [
    "city_center",
    "municipality centroid",
    "centroid of the town",
    "regional centre",
    "county center",
    "historic building footprint centroid",
  ];
  const entries = meanings.map((meaning, i) => {
    const raw = normalRecord(`phasm-us-al-centroid-${i}`);
    raw.name = meaning;
    raw.access.status = "public";
    raw.geography = {
      coordinates: { latitude: 34.5, longitude: -86.5 },
      precision: "approximate",
      point_kind: meaning,
      source_urls: ["https://example.org/geography"],
      mapping_visibility: "public",
    };
    return { raw };
  });
  const input = fixture(entries);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.ok(
      plan.locations
        .slice(0, -1)
        .every(
          (location) =>
            location.latitude === null &&
            location.coordinatePrecision === "withheld",
        ),
    );
    assert.equal(plan.locations.at(-1)!.latitude, 34.5);
    assert.ok(
      plan.records
        .slice(0, -1)
        .every((record) =>
          record.warnings.some((warning) =>
            warning.message.includes("centroid"),
          ),
        ),
    );
  } finally {
    input.close();
  }
});

test("numeric point acceptance requires bounds, evidence and meaning; private and camera points stay null", () => {
  const entries = [
    "valid",
    "private",
    "camera",
    "no-source",
    "zero",
    "out-of-bounds",
    "withheld",
  ].map((kind) => {
    const raw = normalRecord(`phasm-us-al-${kind}`);
    raw.name = kind;
    raw.access.status = kind === "private" ? "private" : "public";
    raw.geography = {
      coordinates: {
        latitude: kind === "zero" ? 0 : kind === "out-of-bounds" ? 91 : 34.5,
        longitude: kind === "zero" ? 0 : -86.5,
      },
      precision: "approximate",
      point_kind:
        kind === "camera" ? "camera viewpoint" : "historic building reference",
      source_url: kind === "no-source" ? null : "https://example.org/geography",
      mapping_visibility:
        kind === "withheld"
          ? "withheld_pending_access_and_geocode_check"
          : "public",
    };
    return { raw };
  });
  const input = fixture(entries);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.locations[0].latitude, 34.5);
    assert.equal(plan.locations[0].coordinatePrecision, "approximate");
    assert.ok(
      plan.locations
        .slice(1)
        .every(
          (location) =>
            location.latitude === null && location.longitude === null,
        ),
    );
    assert.equal(plan.summary.created, 7);
  } finally {
    input.close();
  }
});

test("baseline alias IDs, member text, reviewed coordinates, media, status and international rows survive exactly", () => {
  const existing = structuredClone(
    base.find((location) => location.id === "stanley-hotel")!,
  );
  existing.history = "A member/editor supplied this richer narrative.";
  existing.updatedAt = "2026-10-11T14:00:00Z";
  const raw = normalRecord("phasm-us-co-stanley-hotel");
  raw.name = "The Stanley Hotel";
  raw.city = "Incorrect candidate city";
  raw.history = "Short replacement research.";
  const international = base.filter(
    (location) => location.country !== "United States",
  );
  const input = fixture([
    { raw, baselineId: "stanley-hotel", state: "Colorado", stateCode: "CO" },
  ]);
  try {
    const plan = buildNationwidePlan(input.root, [existing, ...international]);
    assert.deepEqual(plan.locations, [existing, ...international]);
    assert.equal(plan.summary.unchanged, 1);
    assert.equal(plan.records[0].nextLocation!.slug, existing.slug);
    assert.equal(plan.records[0].readiness.coordinate, "preserved");
    assert.ok(
      plan.records[0].warnings.some(
        (warning) => warning.code === "baseline-field-review",
      ),
    );
  } finally {
    input.close();
  }
});

test("baseline enrichment only fills an empty sourced field and rerun leaves timestamp untouched", () => {
  const existing = structuredClone(
    base.find((location) => location.id === "stanley-hotel")!,
  );
  existing.history = "";
  const raw = normalRecord("phasm-us-co-stanley-hotel");
  raw.history = "A sourced new historical paragraph.";
  raw.sources.push({
    title: "History archive",
    url: "https://example.org/history",
    roles: ["history"],
  });
  const input = fixture([
    { raw, baselineId: existing.id, state: "Colorado", stateCode: "CO" },
  ]);
  try {
    const first = buildNationwidePlan(input.root, [existing]);
    assert.equal(first.summary.updated, 1);
    assert.equal(first.locations[0].history, raw.history);
    assert.equal(first.locations[0].reports, existing.reports);
    assert.equal(first.locations[0].sources.at(-1)!.kind, "history");
    const second = buildNationwidePlan(input.root, first.locations);
    assert.equal(second.summary.unchanged, 1);
    assert.deepEqual(second.locations, first.locations);
  } finally {
    input.close();
  }
});

test("additions are idempotent and existing member edits cause conflicts without overwriting", () => {
  const input = fixture();
  try {
    const first = buildNationwidePlan(input.root, []),
      second = buildNationwidePlan(input.root, first.locations);
    assert.equal(second.summary.unchanged, 1);
    assert.deepEqual(second.locations, first.locations);
    assert.equal(second.inputFingerprint, first.inputFingerprint);
    const edited = structuredClone(first.locations);
    edited[0].reports = "An editor corrected the narrative.";
    const conflict = buildNationwidePlan(input.root, edited);
    assert.equal(conflict.summary.conflicted, 1);
    assert.deepEqual(conflict.locations, edited);
  } finally {
    input.close();
  }
});

test("full normalized identity overlap conflicts, while matching names in different cities remain distinct", () => {
  const a = normalRecord("phasm-us-al-a"),
    b = normalRecord("phasm-us-al-b"),
    c = normalRecord("phasm-us-al-c");
  c.city = "Another Town";
  const input = fixture([{ raw: a }, { raw: b }, { raw: c }]);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.summary.created, 2);
    assert.equal(plan.summary.conflicted, 1);
    assert.equal(
      plan.records[1].warnings.at(-1)!.code,
      "current-catalog-overlap",
    );
  } finally {
    input.close();
  }
});

test("invalid URLs stay in sidecars and do not become clickable public sources", () => {
  const raw = normalRecord();
  raw.sources = [
    {
      source_id: "BAD",
      title: "Bad",
      url: "javascript:alert(1)",
      roles: ["story"],
    },
  ];
  raw.access.official_website = "https://user:secret@example.org/";
  const input = fixture([{ raw }]);
  try {
    const record = buildNationwidePlan(input.root, []).records[0];
    assert.equal(record.disposition, "created");
    assert.equal(record.nextLocation!.sources.length, 0);
    assert.equal(record.nextLocation!.officialUrl, "");
    assert.equal(record.readiness.contentReady, false);
    assert.deepEqual(record.sidecar.originalRecord, raw);
  } finally {
    input.close();
  }
});

test("prose and bibliography overflow defer without silently truncating original research", () => {
  const long = normalRecord("phasm-us-al-long");
  long.name = "Long";
  long.haunting_description = "A".repeat(20_001);
  const many = normalRecord("phasm-us-al-many");
  many.name = "Many";
  many.sources = Array.from({ length: 31 }, (_, i) => ({
    title: `Report ${i}`,
    url: `https://example.org/report/${i}`,
    roles: ["story"],
  }));
  const input = fixture([{ raw: long }, { raw: many }]);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.summary.deferred, 2);
    assert.equal(plan.locations.length, 0);
    assert.equal(
      (plan.records[0].sidecar.originalRecord as ObjectValue)
        .haunting_description.length,
      20_001,
    );
    assert.equal(
      (plan.records[1].sidecar.originalRecord as ObjectValue).sources.length,
      31,
    );
    assert.ok(
      plan.records.every((record) =>
        record.warnings.some((warning) => warning.code === "native-validation"),
      ),
    );
  } finally {
    input.close();
  }
});

test("selection leaves every current row unchanged and reports each unselected input as deferred", () => {
  const a = normalRecord("phasm-us-al-a"),
    b = normalRecord("phasm-us-al-b");
  b.name = "Other House";
  const input = fixture([{ raw: a }, { raw: b }]);
  try {
    const plan = buildNationwidePlan(input.root, base, {
      selectedIds: [a.research_id],
    });
    assert.equal(plan.summary.created, 1);
    assert.equal(plan.summary.deferred, 1);
    assert.deepEqual(plan.locations.slice(0, base.length), base);
    assert.equal(plan.locations.length, base.length + 1);
    assert.equal(plan.records.length, 2);
    assert.throws(
      () => buildNationwidePlan(input.root, base, { selectedIds: ["missing"] }),
      /unknown research ID/,
    );
  } finally {
    input.close();
  }
});

test("missing baseline records are not resurrected from historical research", () => {
  const input = fixture([
    {
      raw: normalRecord("phasm-us-co-stanley-hotel"),
      baselineId: "stanley-hotel",
      state: "Colorado",
    },
  ]);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.summary.conflicted, 1);
    assert.equal(plan.locations.length, 0);
    assert.equal(
      plan.records[0].warnings.at(-1)!.code,
      "missing-current-baseline",
    );
  } finally {
    input.close();
  }
});

test("crosswalk disagreement and path traversal reject only their input row", () => {
  const input = fixture();
  try {
    const bad = [{ ...input.rows[0], canonical_site_id: "wrong" }];
    input.write("index/GLOBAL_ID_CROSSWALK.json", bad);
    const conflict = buildNationwidePlan(input.root, []);
    assert.equal(conflict.summary.rejected, 1);
    const traversal = [{ ...input.rows[0], source_file: "../outside.json" }];
    input.write("index/GLOBAL_ID_CROSSWALK.json", traversal);
    input.write("index/PROFILE_INDEX.json", traversal);
    const rejected = buildNationwidePlan(input.root, []);
    assert.equal(rejected.summary.rejected, 1);
    assert.equal(rejected.locations.length, 0);
  } finally {
    input.close();
  }
});

test("hashing is deterministic across object key order and source IDs survive slug normalization", () => {
  assert.equal(hashValue({ b: [1, 2], a: 1 }), hashValue({ a: 1, b: [1, 2] }));
  assert.notEqual(hashValue([1, 2]), hashValue([2, 1]));
  assert.equal(stableJson(null), "null");
  const raw = normalRecord("phasm-us-al-example--house"),
    input = fixture([{ raw }]);
  try {
    const plan = buildNationwidePlan(input.root, []);
    assert.equal(plan.locations[0].id, raw.research_id);
    assert.equal(plan.locations[0].slug, "al-example-house");
  } finally {
    input.close();
  }
});

test(
  "complete research package reconciles all rows and exact baseline preservation with rerun no-op",
  { skip: !process.env.PHASM_NATIONWIDE_INPUT },
  () => {
    const plan = buildNationwidePlan(process.env.PHASM_NATIONWIDE_INPUT!, base);
    assert.equal(plan.records.length, 2853);
    assert.equal(plan.summary.created, 2723);
    assert.equal(plan.summary.unchanged, 130);
    assert.equal(plan.locations.length, 2859);
    assert.deepEqual(plan.locations.slice(0, base.length), base);
    assert.ok(
      plan.locations
        .slice(base.length)
        .every((location) => location.status === "draft"),
    );
    assert.equal(plan.summary.preservedPins, 130);
    assert.equal(plan.summary.newApproximatePins, 31);
    assert.equal(plan.pilotIds.length, 25);
    assert.equal(new Set(plan.pilotIds).size, 25);
    assert.deepEqual(validateImport(plan.locations), plan.locations);
    const again = buildNationwidePlan(
      process.env.PHASM_NATIONWIDE_INPUT!,
      plan.locations,
    );
    assert.equal(again.summary.unchanged, 2853);
    assert.deepEqual(again.locations, plan.locations);
    const bridge = plan.records.find(
      (record) =>
        record.researchId === "phasm-us-ar-springfield-des-arc-bridge",
    )!;
    assert.equal(bridge.nextLocation!.city, "");
    assert.equal(bridge.nextLocation!.latitude, null);
    for (const id of [
      "phasm-us-co-hiwan-homestead-museum",
      "phasm-us-co-lace-house-museum",
      "phasm-us-co-pueblo-firefighters-museum",
    ])
      assert.ok(
        plan.records.find((record) => record.researchId === id)!.sidecar
          .editorialItems.length,
      );
  },
);
