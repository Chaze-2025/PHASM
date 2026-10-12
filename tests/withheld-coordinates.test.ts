import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { type Env } from "../worker/index";
import { validateLocation } from "../worker/validation";
import { locationStatements } from "../worker/location-sql";
import { locationStructuredData } from "../worker/seo";
import { toSql } from "../scripts/import-locations";
import type { AtlasGeoJSON, Location, LocationPage } from "../shared/types";

const mapped: Location = {
  id: "mapped",
  slug: "mapped",
  name: "Mapped Manor",
  city: "Test City",
  state: "Test State",
  country: "United States",
  region: "North America",
  latitude: 40,
  longitude: -100,
  category: "Historic house",
  classification: "local-legend",
  summary: "A test profile.",
  history: "A documented test history.",
  reports: "A sourced test story.",
  phenomena: ["Unexplained sounds"],
  access: "public",
  tours: "unknown",
  accessNotes: "Test visitor information.",
  officialUrl: "https://example.com/visit",
  sources: [
    { title: "History", url: "https://example.com/history", kind: "history" },
    { title: "Reports", url: "https://example.com/reports", kind: "reports" },
  ],
  image: "/images/placeholder.svg",
  imageAlt: "Test illustration",
  imageCredit: "Test",
  imageLicense: "Original illustration",
  imageSource: "",
  status: "published",
  coordinatePrecision: "exact",
  featured: false,
  updatedAt: "2026-10-10",
};
const withheld: Location = {
  ...mapped,
  id: "withheld",
  slug: "withheld",
  name: "Withheld House",
  latitude: null,
  longitude: null,
  coordinatePrecision: "withheld",
  access: "private",
};
const migration = (filename: string) =>
  readFileSync(`migrations/${filename}`, "utf8");

function migrate(
  db: DatabaseSync,
  files = readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort(),
) {
  for (const filename of files) {
    db.exec("BEGIN");
    try {
      db.exec(migration(filename));
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function environment(db: DatabaseSync): Env {
  class Statement {
    values: (string | number | null)[] = [];
    constructor(public sql: string) {}
    bind(...values: (string | number | null)[]) {
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
    ADMIN_TOKEN: "test-withheld-at-least-32-characters-long",
    SITE_URL: "https://phasm.example",
    ASSETS: {
      fetch: async () => new Response("<html></html>"),
    } as unknown as Fetcher,
  };
}

function request(env: Env, path: string, body?: Location) {
  return worker.fetch(
    new Request(
      `https://phasm.example${path}`,
      body
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.ADMIN_TOKEN}`,
            },
            body: JSON.stringify(body),
          }
        : undefined,
    ),
    env,
  );
}

test("withheld coordinates are explicit pairs; private landmark reference points retain researched coordinates", () => {
  assert.deepEqual(validateLocation(withheld), withheld);
  for (const invalid of [
    { ...withheld, latitude: 40 },
    { ...withheld, longitude: -100 },
    { ...withheld, latitude: 40, longitude: -100 },
    { ...withheld, coordinatePrecision: "approximate" },
    { ...mapped, latitude: null },
    { ...mapped, longitude: null },
    { ...mapped, latitude: NaN },
    { ...mapped, latitude: 91 },
    { ...mapped, longitude: -181 },
  ])
    assert.throws(() => validateLocation(invalid), /coordinates/i);
  assert.throws(
    () => validateLocation({ ...mapped, access: "private" }),
    /approximate/,
  );
  assert.equal(
    validateLocation({
      ...mapped,
      access: "private",
      coordinatePrecision: "approximate",
      latitude: 40.123,
    }).latitude,
    40.123,
  );
  assert.equal(
    validateLocation({
      ...mapped,
      access: "private",
      coordinatePrecision: "approximate",
    }).latitude,
    40,
  );
});

test("sourced reports can publish without inventing history, and citation HTTP does not weaken image URLs", () => {
  const reportOnly = {
    ...withheld,
    history: "",
    sources: withheld.sources.filter((source) => source.kind === "reports"),
  };
  assert.equal(validateLocation(reportOnly).history, "");
  assert.throws(
    () => validateLocation({ ...reportOnly, history: "Unsupported history." }),
    /history source/,
  );
  assert.throws(
    () => validateLocation({ ...reportOnly, reports: "" }),
    /reports/,
  );
  assert.throws(
    () => validateLocation({ ...reportOnly, sources: [] }),
    /sources/,
  );
  const httpSource = {
    ...mapped.sources[0],
    url: "http://thegrove-jefferson.com/tour/index.htm",
  };
  const historicalHttp = validateLocation({
    ...mapped,
    officialUrl: httpSource.url,
    sources: [httpSource, mapped.sources[1]],
  });
  assert.equal(historicalHttp.officialUrl, httpSource.url);
  assert.equal(historicalHttp.sources[0].url, httpSource.url);
  assert.throws(
    () =>
      validateLocation({ ...mapped, image: "http://example.com/image.jpg" }),
    /HTTPS/,
  );
  assert.throws(
    () => validateLocation({ ...mapped, officialUrl: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateLocation({
        ...mapped,
        sources: [{ ...httpSource, url: "javascript:alert(1)" }],
      }),
    /HTTPS/,
  );
});

test("populated coordinate migration preserves all identities and relationships, indexes, and FTS maintenance", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, ["0001_foundation.sql", "0002_catalog_sort.sql"]);
    // A non-default rowid detects accidental renumbering during the rebuild.
    db.exec(toSql([mapped]));
    db.exec(`
      UPDATE locations SET rowid = 42 WHERE id = 'mapped';
      INSERT INTO users (id, auth_subject, display_name) VALUES ('reader', 'test-reader', 'Reader');
      INSERT INTO reviews (id, location_id, user_id, body, experience) VALUES ('review', 'mapped', 'reader', 'Test review', 'none');
      INSERT INTO review_phenomena VALUES ('review', 'Unexplained sounds');
      INSERT INTO media (id, uploader_id, location_id, review_id, storage_key, mime_type, license, alt_text) VALUES ('media', 'reader', 'mapped', 'review', 'test-key', 'image/jpeg', 'Test', 'Test');
      INSERT INTO review_replies (id, review_id, user_id, body) VALUES ('reply', 'review', 'reader', 'Test reply');
      INSERT INTO review_reactions VALUES ('review', 'reader');
      INSERT INTO content_reports (id, reporter_id, entity_type, entity_id, reason) VALUES ('report', 'reader', 'location', 'mapped', 'Test');
      INSERT INTO moderation_actions (id, moderator_id, entity_type, entity_id, action, reason) VALUES ('moderation', 'reader', 'review', 'review', 'test', 'Test');
      INSERT INTO appeals (id, user_id, moderation_action_id, body) VALUES ('appeal', 'reader', 'moderation', 'Test');
      INSERT INTO location_suggestions (id, user_id, private_payload_json) VALUES ('suggestion', 'reader', '{}');
      INSERT INTO collections (id, user_id, title) VALUES ('collection', 'reader', 'Test collection');
      INSERT INTO collection_locations VALUES ('collection', 'mapped');
      INSERT INTO editorial_content (id, slug, kind, title, body) VALUES ('article', 'article', 'trail', 'Test trail', 'Test');
      INSERT INTO editorial_content_locations VALUES ('article', 'mapped', 0);
    `);
    const tables = [
      "locations",
      "location_sources",
      "location_phenomena",
      "editorial_audit",
      "users",
      "reviews",
      "review_phenomena",
      "media",
      "review_replies",
      "review_reactions",
      "content_reports",
      "moderation_actions",
      "appeals",
      "location_suggestions",
      "collections",
      "collection_locations",
      "editorial_content",
      "editorial_content_locations",
    ];
    const snapshot = () =>
      tables.map((table) =>
        db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
      );
    const before = snapshot();
    migrate(db, ["0003_withheld_coordinates.sql"]);
    assert.deepEqual(snapshot(), before);
    assert.equal(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const search = (term: string) =>
      db
        .prepare("SELECT rowid FROM locations_fts WHERE locations_fts MATCH ?")
        .all(term)
        .map((row) => row.rowid);
    assert.deepEqual(search("Mapped"), [42]);
    db.exec(toSql([withheld]));
    assert.equal(search("Withheld").length, 1);
    db.exec(
      "UPDATE locations SET name = 'Updated House' WHERE id = 'withheld'",
    );
    assert.equal(search("Withheld").length, 0);
    assert.equal(search("Updated").length, 1);
    db.exec("DELETE FROM locations WHERE id = 'withheld'");
    assert.equal(search("Updated").length, 0);
    db.exec(
      "INSERT INTO location_sources(location_id, title, url, kind) VALUES ('mapped', 'Original HTTP citation', 'http://example.com/source', 'visiting')",
    );
    assert.throws(
      () => db.exec("DELETE FROM locations WHERE id = 'mapped'"),
      /FOREIGN KEY/,
    );
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT data_json FROM locations WHERE status='published' ORDER BY featured DESC, name COLLATE NOCASE, id LIMIT 24",
      )
      .all();
    assert.ok(
      plan.some((row) => String(row.detail).includes("locations_editorial")),
    );
    assert.ok(plan.every((row) => !String(row.detail).includes("TEMP B-TREE")));
  } finally {
    db.close();
  }
});

test("the database enforces null-coordinate pairing and validated SQL stores real NULLs", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db);
    db.exec(toSql([withheld]));
    const row = db
      .prepare(
        "SELECT latitude, longitude, coordinate_precision FROM locations",
      )
      .get()!;
    assert.equal(row.latitude, null);
    assert.equal(row.longitude, null);
    assert.equal(row.coordinate_precision, "withheld");
    for (const update of [
      "latitude = 40",
      "longitude = -100",
      "coordinate_precision = 'exact'",
      "coordinate_precision = 'approximate'",
      "latitude = 40, longitude = -100",
      "latitude = 40, longitude = -100, coordinate_precision = 'exact'",
    ])
      assert.throws(() => db.exec(`UPDATE locations SET ${update}`), /CHECK/);
  } finally {
    db.close();
  }
});

test("withheld profiles remain in catalog, search, metadata and sitemap but never enter points or map clusters", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db);
    for (const location of [mapped, withheld]) {
      for (const statement of locationStatements(location))
        db.prepare(statement.sql).run(...statement.params);
    }
    const env = environment(db);
    const catalog = (await (
      await request(env, "/api/locations")
    ).json()) as LocationPage;
    assert.equal(catalog.total, 2);
    const search = (await (
      await request(env, "/api/locations?q=Withheld")
    ).json()) as LocationPage;
    assert.equal(search.total, 1);
    assert.equal(search.locations[0].latitude, null);
    const profile = (await (
      await request(env, "/api/locations/withheld")
    ).json()) as { location: Location; nearby: Location[] };
    assert.equal(profile.location.coordinatePrecision, "withheld");
    assert.equal(profile.location.longitude, null);
    assert.deepEqual(
      profile.nearby.map((location) => location.id),
      ["mapped"],
    );
    const metadata = (await (await request(env, "/api/meta")).json()) as {
      total: number;
    };
    assert.equal(metadata.total, 2);
    assert.match(
      await (await request(env, "/sitemap.xml")).text(),
      /\/locations\/withheld/,
    );
    for (const zoom of [2, 8]) {
      const atlas = (await (
        await request(env, `/api/atlas?zoom=${zoom}`)
      ).json()) as AtlasGeoJSON;
      assert.equal(atlas.total, 1);
      assert.equal(atlas.features.length, 1);
      assert.deepEqual(atlas.features[0].geometry.coordinates, [-100, 40]);
      assert.equal(atlas.features[0].properties.id, "mapped");
      const withheldSearch = (await (
        await request(env, `/api/atlas?q=Withheld&zoom=${zoom}`)
      ).json()) as AtlasGeoJSON;
      assert.equal(withheldSearch.total, 0);
      assert.deepEqual(withheldSearch.features, []);
    }
    const created = await request(env, "/api/admin/locations", {
      ...withheld,
      id: "admin-withheld",
      slug: "admin-withheld",
      name: "Admin Withheld",
    });
    assert.equal(created.status, 201);
    const adminLocation = (await created.json()) as { location: Location };
    assert.equal(adminLocation.location.latitude, null);
    assert.equal(
      db
        .prepare("SELECT longitude FROM locations WHERE id = 'admin-withheld'")
        .get()!.longitude,
      null,
    );
  } finally {
    db.close();
  }
});

test("profile structured data omits geo for withheld and approximate coordinates", () => {
  assert.equal(
    "geo" in locationStructuredData(withheld, "https://phasm.example"),
    false,
  );
  assert.equal(
    "geo" in
      locationStructuredData(
        { ...mapped, coordinatePrecision: "approximate" },
        "https://phasm.example",
      ),
    false,
  );
  assert.deepEqual(
    locationStructuredData(mapped, "https://phasm.example").geo,
    {
      "@type": "GeoCoordinates",
      latitude: 40,
      longitude: -100,
    },
  );
});
