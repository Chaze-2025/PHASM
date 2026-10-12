import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { Location } from "../shared/types";
import {
  convertResearch,
  sha256,
  type ImportOptions,
  type ResearchLocation,
  type ResearchSource,
  type ReviewedGeocode,
} from "../scripts/research-import";
import { validateImport } from "../scripts/import-locations";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const baseline = readJson(
  "content/research/catalog-before-usa-130.json",
) as Location[];
const catalog = validateImport(readJson("content/locations.json"));
const geocodePath = "content/research/usa-130-geocodes.json";
const reviewedGeocodes: Record<string, ReviewedGeocode> = existsSync(
  geocodePath,
)
  ? readJson(geocodePath)
  : {};

function fixture() {
  const record: ResearchLocation = {
    research_id: "phasm-us-xx-example-house",
    existing_phasm_id: null,
    identity: {
      name: "Example House",
      locality: "Example City",
      state: "Example State",
      state_code: "XX",
      country: "United States",
      continent: "North America",
      primary_category: "Haunted house",
      prominence: "Local lore",
    },
    geography: {
      coordinates: null,
      precision: null,
      mapping_visibility: "withheld_pending_geocode",
    },
    content: {
      card_summary: {
        text: "A house with a local story.",
        source_ids: ["REPORT"],
      },
      introduction: {
        text: "The introduction is retained.",
        source_ids: ["REPORT"],
      },
      history: [],
      hauntings: [
        {
          text: "A named writer describes a single encounter.",
          source_ids: ["REPORT", "DUPLICATE"],
        },
        {
          text: "The second narrative paragraph is retained.",
          source_ids: ["REPORT"],
        },
      ],
      visiting: {
        text: "Private property; no access invitation is established.",
        source_ids: ["VISIT"],
      },
    },
    phenomenon_tags: ["apparitions"],
    access: { status: "Private property", official_website: null },
    source_ids: ["REPORT", "DUPLICATE", "VISIT"],
    community: { reviews: [], ratings: null },
    last_reviewed_on: "2026-10-10",
  };
  const sources: ResearchSource[] = [
    {
      source_id: "REPORT",
      title: "An encounter",
      url: "https://example.com/report",
      organization: "Example Writer",
    },
    {
      source_id: "DUPLICATE",
      title: "The same inspected page",
      url: "https://example.com/report",
      organization: "Example Writer",
    },
    {
      source_id: "VISIT",
      title: "Visitor access",
      url: "https://example.com/visit",
      organization: "Example Owner",
    },
  ];
  const options: ImportOptions = {
    reviews: { [record.research_id]: { access: "private", tours: "unknown" } },
    copyAdjustments: {},
  };
  return { record, sources, options };
}

function geocodeFixture(researchId: string): ReviewedGeocode {
  return {
    researchId,
    latitude: 40.12345,
    longitude: -105.12345,
    precision: "approximate",
    pointKind: "mapped building reference",
    sourceUrl: "https://example.com/map/example-house",
    sourceTitle: "Example House map record",
    evidence:
      "Inspected map record identifies Example House with this coordinate pair.",
    checkedOn: "2026-10-12",
  };
}

test("conversion retains all narrative paragraphs, omits invented history, and withholds unverified pins", () => {
  const { record, sources, options } = fixture();
  const result = convertResearch([record], sources, [], options);
  assert.equal(result.locations.length, 1);
  const location = result.locations[0];
  assert.equal(location.id, record.research_id);
  assert.equal(location.slug, "xx-example-house");
  assert.equal(location.history, "");
  assert.equal(
    location.reports,
    [
      record.content.introduction!.text,
      ...record.content.hauntings.map((block) => block.text),
    ].join("\n\n"),
  );
  assert.equal(location.latitude, null);
  assert.equal(location.longitude, null);
  assert.equal(location.coordinatePrecision, "withheld");
  assert.equal(location.tours, "unknown");
  assert.equal(location.image, "/images/location-placeholder.svg");
  assert.deepEqual(
    location.sources.map((source) => source.kind),
    ["reports", "visiting"],
  );
  // One public link per URL and role, while every research source identity survives.
  assert.match(JSON.stringify(result.provenance), /DUPLICATE/);
  assert.equal(location.sources[0].title, "Example Writer — An encounter");
});

test("conversion updates stable IDs/slugs/images and preserves unrelated baseline rows", () => {
  const { record, sources, options } = fixture();
  record.existing_phasm_id = baseline[0].id;
  const result = convertResearch([record], sources, baseline, options);
  assert.equal(result.locations.length, baseline.length);
  const updated = result.locations[0];
  for (const key of [
    "id",
    "slug",
    "image",
    "imageAlt",
    "imageCredit",
    "imageLicense",
    "imageSource",
    "featured",
  ] as const)
    assert.equal(updated[key], baseline[0][key]);
  assert.deepEqual(result.locations.slice(1), baseline.slice(1));
});

test("reviewed geocodes add source-grounded pins and separate geographic provenance without rewriting stories or access", () => {
  const { record, sources, options } = fixture();
  options.reviews[record.research_id].access = "restricted";
  const original = convertResearch([record], sources, [], options).locations[0];
  const geocode = geocodeFixture(record.research_id);
  options.geocodes = { [record.research_id]: geocode };
  const result = convertResearch([record], sources, [], options);
  const location = result.locations[0];
  assert.deepEqual(location, {
    ...original,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    coordinatePrecision: "approximate",
  });
  assert.equal(result.geocodeSources.length, 1);
  assert.equal(result.geocodeSources[0].sourceType, "geographic_reference");
  assert.equal(result.geocodeSources[0].url, geocode.sourceUrl);
  const provenance = JSON.parse(JSON.stringify(result.provenance[0]));
  assert.equal(provenance.coordinateEnrichment.evidence, geocode.evidence);
  assert.equal(
    provenance.coordinateEnrichment.sourceId,
    `geocode-${record.research_id}`,
  );
  assert.equal(provenance.coordinateEnrichment.checkedOn, "2026-10-12");
  assert.deepEqual(location.sources, original.sources);
});

test("geocode enrichment rejects incomplete evidence, fabricated coordinate placeholders and invalid URLs", () => {
  const { record, sources, options } = fixture();
  options.reviews[record.research_id].access = "restricted";
  const invalidChanges: [Partial<ReviewedGeocode>, RegExp][] = [
    [{ latitude: Number.NaN }, /finite coordinate pair/],
    [{ longitude: 181 }, /finite coordinate pair/],
    [
      { latitude: null } as unknown as Partial<ReviewedGeocode>,
      /finite coordinate pair/,
    ],
    [
      { latitude: "40.12345" } as unknown as Partial<ReviewedGeocode>,
      /finite coordinate pair/,
    ],
    [{ evidence: "" }, /inspected source metadata/],
    [{ sourceTitle: " " }, /inspected source metadata/],
    [{ pointKind: "" }, /inspected source metadata/],
    [{ sourceUrl: "javascript:alert(1)" }, /source URL/],
    [{ sourceUrl: "https://user:pass@example.com/map" }, /source URL/],
    [{ checkedOn: "2026-02-30" }, /valid inspection date/],
    [{ researchId: "other-id" }, /does not match its key/],
    [
      { precision: "withheld" } as unknown as Partial<ReviewedGeocode>,
      /precision must be/,
    ],
  ];
  for (const [change, pattern] of invalidChanges) {
    options.geocodes = {
      [record.research_id]: {
        ...geocodeFixture(record.research_id),
        ...change,
      },
    };
    assert.throws(
      () => convertResearch([record], sources, [], options),
      pattern,
    );
  }
});

test("geocode enrichment cannot alter an existing original pin or reference an unknown research identity", () => {
  const { record, sources, options } = fixture();
  options.reviews[record.research_id].access = "public";
  record.geography = {
    coordinates: { latitude: 39.5, longitude: -104.5 },
    precision: "approximate",
    mapping_visibility: "public",
  };
  options.geocodes = {
    [record.research_id]: geocodeFixture(record.research_id),
  };
  assert.throws(
    () => convertResearch([record], sources, [], options),
    /cannot replace an original public pin/,
  );
  options.geocodes = { "unknown-id": geocodeFixture("unknown-id") };
  assert.throws(
    () => convertResearch([record], sources, [], options),
    /Unused coordinate enrichment/,
  );
});

test("copy changes require the exact reviewed source and reject unused or drifting adjustments", () => {
  const { record, sources, options } = fixture();
  const key = `${record.research_id}/visiting`;
  options.copyAdjustments[key] = {
    sourceSha256: sha256(record.content.visiting.text),
    text: "Private property. No authorized visit is established.",
  };
  assert.equal(
    convertResearch([record], sources, [], options).locations[0].accessNotes,
    options.copyAdjustments[key].text,
  );
  record.content.visiting.text += " Changed.";
  assert.throws(
    () => convertResearch([record], sources, [], options),
    /Reviewed copy has changed/,
  );
});

test("conversion rejects missing evidence, unmatched existing IDs and invented community activity", () => {
  const missing = fixture();
  missing.record.content.introduction!.source_ids = ["UNMAPPED"];
  assert.throws(
    () =>
      convertResearch([missing.record], missing.sources, [], missing.options),
    /Unmapped summary\/introduction source/,
  );
  const existing = fixture();
  existing.record.existing_phasm_id = "missing-existing-id";
  assert.throws(
    () =>
      convertResearch(
        [existing.record],
        existing.sources,
        [],
        existing.options,
      ),
    /Existing app ID missing/,
  );
  const review = fixture();
  review.record.community.reviews = [{ body: "Not a real member submission." }];
  assert.throws(
    () => convertResearch([review.record], review.sources, [], review.options),
    /must not supply member activity/,
  );
});

test("complete catalog reconciles all research identities and preserves every public source reference", () => {
  const provenance = readJson("content/research/usa-130-provenance.json");
  const sources = readJson("content/research/usa-130-sources.json") as {
    sourceId: string;
    url: string;
  }[];
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  assert.equal(catalog.length, 136);
  assert.equal(provenance.locations.length, 130);
  const geocodeCount = Object.keys(reviewedGeocodes).length;
  if (existsSync(geocodePath))
    assert.equal(
      geocodeCount,
      75,
      "The reviewed complete atlas maps all 75 previously missing points.",
    );
  assert.equal(sourceIds.size, 431 + geocodeCount);
  assert.equal(
    new Set(
      catalog
        .filter((location) => location.country === "United States")
        .map((location) => location.state),
    ).size,
    50,
  );
  assert.equal(
    catalog.filter((location) => location.coordinatePrecision === "withheld")
      .length,
    75 - geocodeCount,
  );
  assert.equal(
    catalog.filter(
      (location) => location.latitude !== null && location.longitude !== null,
    ).length,
    61 + geocodeCount,
  );
  assert.equal(
    catalog.filter(
      (location) => location.image === "/images/location-placeholder.svg",
    ).length,
    126,
  );
  assert.deepEqual(
    catalog
      .filter((location) => !location.history)
      .map((location) => location.id)
      .sort(),
    [
      "phasm-us-nh-pine-hill-cemetery",
      "phasm-us-sd-hotel-alex-johnson",
      "phasm-us-tx-marfa-lights",
    ],
  );
  for (const row of provenance.locations) {
    assert.ok(
      catalog.some(
        (location) => location.id === row.appId && location.slug === row.slug,
      ),
    );
    for (const id of row.sourceIds)
      assert.ok(sourceIds.has(id), `Missing public bibliography entry: ${id}`);
    for (const role of row.sourceRoles) assert.ok(sourceIds.has(role.sourceId));
    const geocode = reviewedGeocodes[row.researchId];
    if (geocode) {
      const location = catalog.find((entry) => entry.id === row.appId)!;
      assert.equal(location.latitude, geocode.latitude);
      assert.equal(location.longitude, geocode.longitude);
      assert.equal(location.coordinatePrecision, geocode.precision);
      assert.equal(
        row.coordinateEnrichment.sourceId,
        `geocode-${row.researchId}`,
      );
      assert.ok(sourceIds.has(row.coordinateEnrichment.sourceId));
    }
  }
  for (const location of catalog) {
    assert.equal(
      new Set(location.sources.map((source) => `${source.kind}:${source.url}`))
        .size,
      location.sources.length,
    );
    if (location.coordinatePrecision === "withheld") {
      assert.equal(location.latitude, null);
      assert.equal(location.longitude, null);
    }
  }
  for (const old of baseline.filter(
    (location) => location.country !== "United States",
  ))
    assert.deepEqual(
      catalog.find((location) => location.id === old.id),
      old,
    );
  const grove = catalog.find(
    (location) => location.id === "phasm-us-tx-the-grove",
  )!;
  assert.equal(
    grove.officialUrl,
    "http://thegrove-jefferson.com/tour/index.htm",
  );
  assert.ok(
    grove.sources.some(
      (source) =>
        source.url === grove.officialUrl && source.kind === "visiting",
    ),
  );
});
