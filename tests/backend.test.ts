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

test("atlas aggregates over 5,000 records in SQL into no more than 500 points", async () => {
  const locations = Array.from({ length: 5100 }, (_, index) => ({
    ...fixture,
    id: `load-${index}`,
    slug: `load-${index}`,
    name: `Load ${index}`,
    longitude: -179 + (index % 170) * 2.1,
    latitude: -70 + Math.floor(index / 170) * 4.5,
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
