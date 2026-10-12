import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Location } from "../shared/types";
import {
  convertResearch,
  sha256,
  type ImportOptions,
  type ResearchLocation,
  type ResearchSource,
} from "../scripts/research-import";
import { validateImport } from "../scripts/import-locations";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const baseline = readJson(
  "content/research/catalog-before-usa-130.json",
) as Location[];
const catalog = validateImport(readJson("content/locations.json"));

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
  assert.equal(sourceIds.size, 431);
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
    75,
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
