import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { type Env } from "../worker/index";
import { validateLocation, parseBounds } from "../worker/validation";
import { validateImport } from "../scripts/import-locations";
import { locationStatements } from "../worker/location-sql";
import type { Location } from "../shared/types";

const TOKEN = "a-strong-test-token-at-least-32-characters";
const fixture: Location = {
  id: "test-stanley",
  slug: "test-stanley",
  name: "Test Stanley",
  city: "Estes Park",
  state: "Colorado",
  country: "United States",
  region: "North America",
  latitude: 40.38,
  longitude: -105.52,
  category: "Hotel",
  classification: "established",
  summary: "Fixture for API tests; never published as production content.",
  history: "Test history.",
  reports: "Test folklore.",
  phenomena: ["Unexplained sounds"],
  access: "public",
  tours: "yes",
  accessNotes: "Test visiting information.",
  officialUrl: "https://example.com",
  sources: [
    {
      title: "Test history source",
      url: "https://example.com/history",
      kind: "history",
    },
    {
      title: "Test reports source",
      url: "https://example.com/reports",
      kind: "reports",
    },
  ],
  image: "/images/placeholder.svg",
  imageAlt: "Illustrative test placeholder",
  imageCredit: "Test",
  imageLicense: "Original placeholder",
  imageSource: "",
  status: "published",
  coordinatePrecision: "exact",
  featured: false,
  updatedAt: "2026-10-08",
};

function createEnv(locations: Location[] = [fixture]): Env {
  const db = new DatabaseSync(":memory:");
  for (const filename of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(`migrations/${filename}`, "utf8"));
  }
  class Statement {
    values: (string | number)[] = [];
    constructor(public sql: string) {}
    bind(...values: (string | number)[]) {
      this.values = values;
      return this;
    }
    async first() {
      return db.prepare(this.sql).get(...this.values) ?? null;
    }
    async all() {
      return {
        success: true,
        results: db.prepare(this.sql).all(...this.values),
        meta: {},
      };
    }
    async run() {
      return db.prepare(this.sql).run(...this.values);
    }
  }
  for (const location of locations)
    for (const statement of locationStatements(location))
      db.prepare(statement.sql).run(...statement.params);
  return {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        db.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements)
            results.push(await statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database,
    ADMIN_TOKEN: TOKEN,
    SITE_URL: "https://phasm.example",
    ASSETS: {
      fetch: async () =>
        new Response(
          '<html><head><title>PHASM</title></head><body><div id="root"></div></body></html>',
          { headers: { "Content-Type": "text/html" } },
        ),
    } as unknown as Fetcher,
  };
}
function request(path: string, env: Env, init?: RequestInit) {
  return worker.fetch(new Request(`https://phasm.example${path}`, init), env);
}
function auth(body?: unknown) {
  return {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

test("publication validation rejects uncredited sources, unsafe URLs and private exact coordinates", () => {
  assert.throws(() => validateLocation({ ...fixture, sources: [] }), /sources/);
  assert.throws(
    () => validateLocation({ ...fixture, officialUrl: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.throws(
    () => validateLocation({ ...fixture, access: "private" }),
    /approximate/,
  );
  assert.equal(
    validateLocation({
      ...fixture,
      access: "private",
      coordinatePrecision: "approximate",
    }).latitude,
    fixture.latitude,
  );
  assert.equal(
    validateLocation({ ...fixture, coordinatePrecision: "approximate" })
      .latitude,
    fixture.latitude,
  );
  assert.equal(
    validateLocation({
      ...fixture,
      access: "private",
      coordinatePrecision: "approximate",
      latitude: 40.4,
      longitude: -105.5,
    }).access,
    "private",
  );
});

test("coordinate references preserve sourced approximate points and reject misleading metadata", () => {
  const reference = {
    scope: "locality",
    label: "Estes Park, Colorado",
    sourceUrl: "https://www.census.gov/geographies/reference-files.html",
  };
  const location = {
    ...fixture,
    coordinatePrecision: "approximate",
    coordinateReference: reference,
  };
  assert.deepEqual(validateLocation(location).coordinateReference, reference);
  assert.equal(
    Object.hasOwn(validateLocation(fixture), "coordinateReference"),
    false,
  );
  for (const scope of ["site", "locality", "county", "state"]) {
    assert.equal(
      validateLocation({
        ...location,
        coordinateReference: { ...reference, scope },
      }).coordinateReference?.scope,
      scope,
    );
  }
  for (const invalid of [
    null,
    [],
    "Estes Park",
    { ...reference, scope: "entrance" },
    { ...reference, label: " " },
    { ...reference, label: "x".repeat(251) },
    { ...reference, sourceUrl: "" },
    { ...reference, sourceUrl: "javascript:alert(1)" },
    { ...reference, sourceUrl: "//example.com" },
    { ...reference, sourceUrl: "https://user:password@example.com" },
  ]) {
    assert.throws(() =>
      validateLocation({ ...location, coordinateReference: invalid }),
    );
  }
  assert.throws(
    () => validateLocation({ ...location, coordinatePrecision: "exact" }),
    /reference pins require approximate/,
  );
  assert.throws(
    () =>
      validateLocation({
        ...location,
        latitude: null,
        longitude: null,
        coordinatePrecision: "withheld",
      }),
    /reference pins require approximate/,
  );
  assert.throws(
    () => validateLocation({ ...location, latitude: null }),
    /Coordinates/,
  );
});

test("reference pins retain their labels in public summaries and remain mapped at the original coordinates", async () => {
  const location = validateLocation({
    ...fixture,
    coordinatePrecision: "approximate",
    coordinateReference: {
      scope: "county",
      label: "Larimer County, Colorado",
      sourceUrl: "https://www.census.gov/geographies/reference-files.html",
    },
  });
  const env = createEnv([location]);
  const summary = (await (
    await request("/api/locations/test-stanley?format=summary", env)
  ).json()) as any;
  assert.deepEqual(
    summary.location.coordinateReference,
    location.coordinateReference,
  );
  const list = (await (
    await request("/api/locations?format=summary", env)
  ).json()) as any;
  assert.deepEqual(
    list.locations[0].coordinateReference,
    location.coordinateReference,
  );
  const atlas = (await (
    await request("/api/atlas?zoom=10", env)
  ).json()) as any;
  assert.equal(atlas.total, 1);
  assert.deepEqual(atlas.features[0].geometry.coordinates, [
    location.longitude,
    location.latitude,
  ]);
});

test("import detects normalized identities and duplicate slugs before database writes", () => {
  assert.throws(
    () =>
      validateImport([
        fixture,
        { ...fixture, id: "other", slug: "other", name: " TEST STANLEY " },
      ]),
    /Duplicate/,
  );
  assert.throws(
    () => validateImport([fixture, { ...fixture, id: "other" }]),
    /Duplicate/,
  );
  assert.equal(
    validateImport([
      fixture,
      { ...fixture, id: "other", slug: "other", state: "Wyoming" },
    ]).length,
    2,
  );
});

test("public location search, facets and pagination hide drafts and withstand SQL syntax", async () => {
  const env = createEnv([
    fixture,
    {
      ...fixture,
      id: "hidden",
      slug: "hidden",
      name: "Hidden Record",
      status: "draft",
      phenomena: ["Hidden phenomenon"],
      category: "Hidden category",
    },
  ]);
  const found = await request(
    "/api/locations?q=Estes%20Colorado&category=Hotel&pageSize=999",
    env,
  );
  const result = (await found.json()) as any;
  assert.equal(result.total, 1);
  assert.equal(result.pageSize, 50);
  assert.equal(result.locations[0].id, fixture.id);
  assert.equal((await request("/api/locations/hidden", env)).status, 404);
  assert.equal((await request("/api/locations?page=-1", env)).status, 400);
  const injection = (await (
    await request("/api/locations?q=%27%20OR%201%3D1%20--", env)
  ).json()) as any;
  assert.equal(injection.total, 0);
  const metadata = (await (await request("/api/meta", env)).json()) as any;
  assert.deepEqual(metadata.categories, ["Hotel"]);
  assert.deepEqual(metadata.phenomena, ["Unexplained sounds"]);
  const profile = (await (
    await request("/api/locations/test-stanley", env)
  ).json()) as any;
  assert.equal(profile.location.slug, fixture.slug);
  assert.deepEqual(profile.nearby, []);
  const sitemap = await (await request("/sitemap.xml", env)).text();
  assert.ok(sitemap.includes("/locations/test-stanley"));
  assert.ok(!sitemap.includes("hidden"));
});

test("atlas validates geographic bounds, crosses the antimeridian and excludes out-of-viewport records", async () => {
  assert.throws(() => parseBounds("NaN,0,20,10"));
  assert.throws(() => parseBounds("0,10,20,0"));
  const env = createEnv([
    fixture,
    {
      ...fixture,
      id: "east",
      slug: "east",
      name: "East",
      latitude: 0,
      longitude: 179,
    },
    {
      ...fixture,
      id: "west",
      slug: "west",
      name: "West",
      latitude: 0,
      longitude: -179,
    },
  ]);
  const result = (await (
    await request("/api/atlas?bbox=170,-10,-170,10&zoom=8", env)
  ).json()) as any;
  assert.equal(result.total, 2);
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features.map((f: any) => f.properties.id).sort(), [
    "east",
    "west",
  ]);
  assert.equal((await request("/api/atlas?bbox=NaN,0,10,10", env)).status, 400);
  const clustered = (await (
    await request("/api/atlas?bbox=170,-10,-170,10&zoom=1", env)
  ).json()) as any;
  assert.equal(
    clustered.features.reduce(
      (sum: number, f: any) => sum + f.properties.count,
      0,
    ),
    2,
  );
});

test("explicit atlas point feeds return all 2,859 mapped public records without profile payloads", async () => {
  const locations = Array.from({ length: 2859 }, (_, index) => ({
    ...fixture,
    id: `national-${index}`,
    slug: `national-${index}`,
    name: `National ${index}`,
    longitude: -124 + (index % 120) / 3,
    latitude: 25 + Math.floor(index / 120),
  }));
  const env = createEnv([
    ...locations,
    {
      ...fixture,
      id: "private-draft",
      slug: "private-draft",
      name: "Private draft",
      status: "draft",
    },
    {
      ...fixture,
      id: "unmapped",
      slug: "unmapped",
      name: "Unmapped",
      latitude: null,
      longitude: null,
      coordinatePrecision: "withheld",
    },
  ]);
  const data = (await (
    await request("/api/atlas?format=points&zoom=2", env)
  ).json()) as any;
  assert.equal(data.total, 2859);
  assert.equal(data.features.length, 2859);
  assert.equal(data.truncated, false);
  assert.deepEqual(
    data.features.map((feature: any) => feature.properties.id).sort(),
    locations.map((location) => location.id).sort(),
  );
  for (const feature of data.features) {
    assert.equal(feature.properties.clustered, false);
    assert.equal(feature.properties.count, 1);
    assert.deepEqual(Object.keys(feature.properties).sort(), [
      "category",
      "clustered",
      "count",
      "id",
      "name",
      "slug",
    ]);
  }
  for (const path of [
    "/api/atlas?zoom=10",
    "/api/atlas?format=points&bbox=-180,-85,180,85&zoom=10",
  ]) {
    const bounded = (await (await request(path, env)).json()) as any;
    assert.equal(bounded.total, 2859);
    assert.ok(bounded.features.length <= 500);
    assert.equal(
      bounded.features.reduce(
        (sum: number, feature: any) => sum + feature.properties.count,
        0,
      ),
      2859,
    );
  }
  const filtered = (await (
    await request("/api/atlas?format=points&q=National%202858", env)
  ).json()) as any;
  assert.equal(filtered.total, 1);
  assert.equal(filtered.features[0].properties.id, "national-2858");
});

test("atlas aggregates over 5,000 records in SQL into no more than 500 points", async () => {
  const locations = Array.from({ length: 5100 }, (_, index) => ({
    ...fixture,
    id: `load-${index}`,
    slug: `load-${index}`,
    name: `Load ${index}`,
    longitude: -179 + (index % 170) * 2.1,
    latitude: -70 + Math.floor(index / 170) * 4.5,
    classification:
      index < 5000 ? ("established" as const) : ("local-legend" as const),
  }));
  const env = createEnv(locations);
  const data = (await (
    await request("/api/atlas?bbox=-180,-85,180,85&zoom=10", env)
  ).json()) as any;
  assert.equal(data.total, 5100);
  assert.ok(data.features.length <= 500);
  assert.equal(
    data.features.reduce(
      (sum: number, feature: any) => sum + feature.properties.count,
      0,
    ),
    5100,
  );
  assert.ok(data.features.some((feature: any) => feature.properties.clustered));
  const overflow = (await (
    await request("/api/atlas?format=points&zoom=5", env)
  ).json()) as any;
  assert.equal(overflow.total, 5100);
  assert.ok(overflow.features.length <= 500);
  assert.equal(
    overflow.features.reduce(
      (sum: number, feature: any) => sum + feature.properties.count,
      0,
    ),
    5100,
  );
  assert.equal(overflow.truncated, false);
  const boundary = (await (
    await request("/api/atlas?format=points&classification=established", env)
  ).json()) as any;
  assert.equal(boundary.total, 5000);
  assert.equal(boundary.features.length, 5000);
  assert.ok(
    boundary.features.every((feature: any) => !feature.properties.clustered),
  );
});

test("admin fails closed, enforces authorization and origin, then saves validated records", async () => {
  const env = createEnv();
  assert.equal(
    (await request("/api/admin/locations", { ...env, ADMIN_TOKEN: undefined }))
      .status,
    503,
  );
  assert.equal((await request("/api/admin/locations", env)).status, 401);
  const newLocation = {
    ...fixture,
    id: "new",
    slug: "new",
    name: "New Location",
    status: "draft",
  };
  assert.equal(
    (
      await request("/api/admin/locations", env, {
        method: "POST",
        ...auth(newLocation),
        headers: { ...auth().headers, Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/locations", env, {
        method: "POST",
        ...auth(newLocation),
      })
    ).status,
    201,
  );
  assert.equal((await request("/api/locations/new", env)).status, 404);
  const published = { ...newLocation, status: "published" };
  assert.equal(
    (
      await request("/api/admin/locations/new", env, {
        method: "PUT",
        ...auth(published),
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/locations/new", env)).status, 200);
  assert.equal(
    (
      await request("/api/admin/locations", env, {
        method: "POST",
        ...auth(published),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/admin/locations/new", env, {
        method: "PUT",
        ...auth({ ...published, status: "archived" }),
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/locations/new", env)).status, 404);
  const admin = (await (
    await request("/api/admin/locations", env, auth())
  ).json()) as any;
  assert.equal(admin.total, 2);
});

test("community writes remain disabled and body limits are enforced", async () => {
  const env = createEnv();
  assert.equal(
    (await request("/api/reviews", env, { method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/locations", env, {
        method: "POST",
        headers: auth().headers,
        body: "a".repeat(100000),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await request("/api/admin/locations", env, {
        method: "POST",
        headers: auth().headers,
        body: "{broken",
      })
    ).status,
    400,
  );
});

test("catalog pagination uses the matching index without sorting the full catalog", async () => {
  const env = createEnv();
  const result = await env.DB.prepare(
    "EXPLAIN QUERY PLAN SELECT l.data_json FROM locations l WHERE l.status = 'published' ORDER BY l.featured DESC, l.name COLLATE NOCASE, l.id LIMIT 24 OFFSET 0",
  ).all<{ detail: string }>();
  assert.ok(
    result.results.some((row) => row.detail.includes("locations_editorial")),
  );
  assert.ok(result.results.every((row) => !row.detail.includes("TEMP B-TREE")));
});

test("summary formats keep catalog fields, ordering and pagination while full APIs remain compatible", async () => {
  const env = createEnv([
    fixture,
    { ...fixture, id: "second", slug: "second", name: "Another place" },
    { ...fixture, id: "draft", slug: "draft", name: "Draft", status: "draft" },
  ]);
  const full = (await (
    await request("/api/locations?pageSize=1", env)
  ).json()) as any;
  const cards = (await (
    await request("/api/locations?pageSize=1&format=summary", env)
  ).json()) as any;
  assert.equal(cards.total, 2);
  assert.equal(cards.pageSize, 1);
  assert.equal(cards.locations[0].slug, full.locations[0].slug);
  for (const field of [
    "latitude",
    "longitude",
    "coordinatePrecision",
    "summary",
    "phenomena",
    "imageLicense",
    "access",
    "tours",
  ])
    assert.deepEqual(cards.locations[0][field], full.locations[0][field]);
  for (const field of [
    "history",
    "reports",
    "accessNotes",
    "officialUrl",
    "sources",
    "imageCredit",
    "imageSource",
  ]) {
    assert.ok(field in full.locations[0]);
    assert.ok(!(field in cards.locations[0]));
  }
  let queries = 0;
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => {
    queries++;
    return prepare(sql);
  };
  const preview = (await (
    await request(`/api/locations/${fixture.slug}?format=summary`, env)
  ).json()) as any;
  assert.equal(queries, 1);
  assert.equal(preview.location.slug, fixture.slug);
  assert.ok(!("nearby" in preview));
  const profile = (await (
    await request(`/api/locations/${fixture.slug}`, env)
  ).json()) as any;
  assert.deepEqual(profile.location, fixture);
  assert.equal(profile.nearby[0].slug, "second");
  const admin = (await (
    await request("/api/admin/locations?format=summary", env, auth())
  ).json()) as any;
  assert.equal(admin.total, 3);
  assert.ok("history" in admin.locations[0]);
});

test("metadata returns all published facets and total in one D1 statement", async () => {
  const env = createEnv([
    fixture,
    {
      ...fixture,
      id: "draft",
      slug: "draft",
      name: "Draft",
      status: "draft",
      region: "Hidden region",
      category: "Castle",
    },
  ]);
  let queries = 0;
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => {
    queries++;
    return prepare(sql);
  };
  const meta = (await (await request("/api/meta", env)).json()) as any;
  assert.equal(queries, 1);
  assert.deepEqual(meta, {
    categories: ["Hotel"],
    phenomena: ["Unexplained sounds"],
    regions: ["North America"],
    classifications: ["established"],
    total: 1,
  });
});

test("only successful anonymous public JSON permits 30-second browser caching", async () => {
  const env = createEnv();
  for (const path of [
    "/api/meta",
    "/api/locations",
    "/api/atlas?zoom=5",
    `/api/locations/${fixture.slug}`,
    `/api/locations/${fixture.slug}?format=summary`,
  ]) {
    const result = await request(path, env);
    assert.equal(
      result.headers.get("Cache-Control"),
      "public, max-age=30",
      path,
    );
    assert.equal(result.headers.get("Vary"), "Authorization, Cookie");
  }
  for (const [path, init] of [
    ["/api/admin/locations", auth()],
    ["/api/admin/locations", undefined],
    ["/api/locations/unavailable", undefined],
    ["/api/atlas?zoom=bad", undefined],
    ["/api/meta", { headers: { Cookie: "session=test" } }],
    ["/api/meta", auth()],
    ["/api/reviews", { method: "POST" }],
  ] as [string, RequestInit | undefined][]) {
    assert.equal(
      (await request(path, env, init)).headers.get("Cache-Control"),
      "no-store",
      path,
    );
  }
});

test("private research review requires authorization, pages summaries and never exposes drafts through public surfaces", async () => {
  const draft: Location = {
    ...fixture,
    id: "private-research",
    slug: "private-research",
    name: "Unpublished Research",
    state: "Wyoming",
    status: "draft",
    category: "Draft category",
    phenomena: ["Draft phenomenon"],
    history: "Private research history.",
  };
  const unmapped: Location = {
    ...draft,
    id: "unmapped-research",
    slug: "unmapped-research",
    name: "Unmapped Research",
    latitude: null,
    longitude: null,
    coordinatePrecision: "withheld",
    access: "unknown",
  };
  const env = createEnv([fixture, draft, unmapped]);
  for (const path of [
    "/api/admin/review/locations",
    "/api/admin/review/locations/private-research",
    "/api/admin/review/meta",
    "/api/admin/review/atlas",
  ]) {
    assert.equal((await request(path, env)).status, 401, path);
    assert.equal(
      (await request(path, { ...env, ADMIN_TOKEN: undefined }, auth())).status,
      503,
      path,
    );
    const authorized = await request(path, env, auth());
    assert.equal(authorized.status, 200, path);
    assert.equal(authorized.headers.get("Cache-Control"), "no-store", path);
    assert.equal(
      authorized.headers.get("X-Robots-Tag"),
      "noindex, nofollow",
      path,
    );
  }
  const cards = (await (
    await request(
      "/api/admin/review/locations?status=draft&state=Wyoming&pageSize=1",
      env,
      auth(),
    )
  ).json()) as any;
  assert.equal(cards.total, 2);
  assert.equal(cards.locations.length, 1);
  assert.ok(!("history" in cards.locations[0]));
  const second = (await (
    await request(
      "/api/admin/review/locations?status=draft&state=Wyoming&pageSize=1&page=2",
      env,
      auth(),
    )
  ).json()) as any;
  assert.notEqual(second.locations[0].id, cards.locations[0].id);
  const detail = (await (
    await request("/api/admin/review/locations/unmapped-research", env, auth())
  ).json()) as any;
  assert.deepEqual(detail.location, unmapped);
  const mapped = (await (
    await request(
      "/api/admin/review/atlas?zoom=8&status=draft&state=Wyoming",
      env,
      auth(),
    )
  ).json()) as any;
  assert.equal(mapped.total, 1);
  assert.equal(mapped.features[0].properties.id, draft.id);
  assert.ok(!JSON.stringify(mapped).includes("Private research history"));
  const emptyMap = (await (
    await request("/api/admin/review/atlas?zoom=1&q=Unmapped", env, auth())
  ).json()) as any;
  assert.equal(emptyMap.total, 0);
  const metadata = (await (
    await request("/api/admin/review/meta", env, auth())
  ).json()) as any;
  assert.deepEqual(
    metadata.groups.find((group: any) => group.state === "Wyoming"),
    { state: "Wyoming", status: "draft", total: 2, mapped: 1 },
  );
  for (const path of [
    "/api/locations?q=Research&status=draft&includeDrafts=true",
    "/api/locations?q=Research&format=summary",
    "/api/atlas?zoom=8&status=draft&includeDrafts=true",
    "/api/atlas?zoom=1",
    "/api/meta",
    "/sitemap.xml",
  ]) {
    const response = await request(path, env, auth());
    const body = await response.text();
    assert.equal(response.status, 200, path);
    assert.ok(
      !/private-research|unmapped-research|Draft category|Draft phenomenon/.test(
        body,
      ),
      path,
    );
  }
  for (const path of [
    "/api/locations/private-research",
    "/api/locations/private-research?format=summary",
    "/locations/private-research",
    "/locations/unmapped-research",
  ]) {
    const response = await request(path, env, auth());
    assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes("Private research history"));
  }
});

test("read-only preview binding rejects authenticated writes and leaves the catalog unchanged", async () => {
  const env = { ...createEnv(), EDITORIAL_READ_ONLY: "true" };
  for (const [method, path, body] of [
    [
      "POST",
      "/api/admin/locations",
      {
        ...fixture,
        id: "new-draft",
        slug: "new-draft",
        name: "New draft",
        status: "draft",
      },
    ],
    [
      "PUT",
      `/api/admin/locations/${fixture.id}`,
      { ...fixture, summary: "Changed" },
    ],
  ] as const) {
    assert.equal(
      (await request(path, env, { method, ...auth(body) })).status,
      403,
    );
  }
  const current = (await (
    await request(`/api/admin/review/locations/${fixture.slug}`, env, auth())
  ).json()) as any;
  assert.deepEqual(current.location, fixture);
  const records = (await (
    await request("/api/admin/locations", env, auth())
  ).json()) as any;
  assert.equal(records.total, 1);
});
