import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Location } from "../shared/types";
import { validateLocation } from "../worker/validation";
import { toSql } from "../scripts/import-locations";
import {
  applyRun,
  canonical,
  catalog,
  digest,
  makeOperation,
  openImportStore,
  recordState,
  rollbackRun,
  runId,
  runProgress,
  verifyProjection,
  type ImportRun,
} from "../scripts/nationwide-store";

function location(id: string, overrides: Partial<Location> = {}): Location {
  return validateLocation({
    id,
    slug: id,
    name: `Research site ${id}`,
    city: "Sample City",
    state: "Virginia",
    country: "United States",
    region: "Southern United States",
    latitude: 37.5,
    longitude: -77.5,
    category: "Historic house",
    classification: "local-legend",
    summary: "A documented historic site.",
    history: "Historical context with a named source.",
    reports: "Local sources report a haunting tradition.",
    phenomena: ["Unexplained sounds", "Apparitions"],
    access: "public",
    tours: "unknown",
    accessNotes: "Check the operator's visiting information.",
    officialUrl: "https://example.org/visit",
    sources: [
      {
        title: "Historical record",
        url: `https://example.org/${id}/history`,
        kind: "history",
      },
      {
        title: "Reported folklore",
        url: `https://example.org/${id}/reports`,
        kind: "reports",
      },
    ],
    image: "/images/location-placeholder.svg",
    imageAlt: "Illustrated location placeholder",
    imageCredit: "PHASM",
    imageLicense: "Original illustration",
    imageSource: "",
    status: "draft",
    coordinatePrecision: "exact",
    featured: false,
    updatedAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  });
}

const applicationTables = [
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
] as const;

function snapshot(
  db: DatabaseSync,
  tables: readonly string[] = applicationTables,
) {
  return canonical(
    Object.fromEntries(
      tables.map((table) => [
        table,
        db
          .prepare(
            `SELECT rowid AS snapshot_rowid, * FROM ${table} ORDER BY rowid`,
          )
          .all(),
      ]),
    ),
  );
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "phasm-nationwide-store-"));
  const path = join(directory, "catalog.sqlite"),
    journal = join(directory, "import.sqlite");
  let db = new DatabaseSync(path);
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  const baseline = [
    location("existing", { status: "published" }),
    location("unrelated"),
  ];
  db.exec(toSql(baseline));
  db.exec(
    "INSERT INTO users (id,auth_subject,display_name) VALUES ('member','fixture-only-subject','Existing member')",
  );
  db.prepare(
    "INSERT INTO reviews (id,location_id,user_id,body,experience,status) VALUES ('prior-review','existing','member','A prior contribution.','reported','published')",
  ).run();
  db.exec("INSERT INTO review_phenomena VALUES ('prior-review','Apparitions')");
  db.exec(
    "INSERT INTO collections (id,user_id,title) VALUES ('prior-collection','member','Saved places')",
  );
  db.exec(
    "INSERT INTO collection_locations VALUES ('prior-collection','existing')",
  );
  db.close();
  db = openImportStore(path, journal);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get db() {
      return db;
    },
    baseline,
    reopen() {
      db.close();
      db = openImportStore(path, journal);
      return db;
    },
  };
}

function run(
  db: DatabaseSync,
  locations: Location[],
  kind: ImportRun["kind"] = "content",
): ImportRun {
  return {
    importerVersion: "test-adapter-1",
    inputHash: "verified-fixture-sha256",
    kind,
    operations: locations.map((next) => makeOperation(db, next)),
  };
}

test("operation before-images include relational source IDs, rowids and original JSON; the sidecar leaves the app schema unchanged", (t) => {
  const { db, baseline } = fixture(t);
  const op = makeOperation(db, {
    ...baseline[0],
    summary: "Additive research summary.",
  });
  assert.deepEqual(op.before, baseline[0]);
  assert.equal(op.expectedState!.location.rowid, 1);
  assert.equal(
    op.expectedState!.location.data_json,
    JSON.stringify(baseline[0]),
  );
  assert.deepEqual(
    op.expectedState!.sources.map((row) => row.id),
    [1, 2],
  );
  assert.deepEqual(
    op.expectedState!.phenomena.map((row) => row.rowid),
    [1, 2],
  );
  assert.equal(makeOperation(db, location("new-location")).expectedState, null);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('runs','operations')",
      )
      .get()!.n,
    0,
  );
  assert.equal(
    db.prepare("PRAGMA main.journal_mode").get()!.journal_mode,
    "delete",
  );
  assert.equal(
    db.prepare("PRAGMA import_log.journal_mode").get()!.journal_mode,
    "delete",
  );
  assert.equal(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys, 1);
  verifyProjection(db);
});

test("content batches preserve member work, original identity and source IDs; exact and regenerated reruns leave all app bytes and ordering unchanged", (t) => {
  const { db, baseline } = fixture(t);
  const original = recordState(db, "existing")!;
  const memberTables = applicationTables.filter(
    (table) =>
      ![
        "locations",
        "location_sources",
        "location_phenomena",
        "editorial_audit",
      ].includes(table),
  );
  const members = snapshot(db, memberTables);
  const next = {
    ...baseline[0],
    summary: "A careful additive update.",
    sources: [
      { ...baseline[0].sources[0], title: "Expanded historical reference" },
      baseline[0].sources[1],
      {
        title: "Visitor information",
        url: "https://example.org/visiting",
        kind: "visiting" as const,
      },
    ],
    phenomena: [...baseline[0].phenomena, "Unusual sensations"],
  };
  const plan = run(db, [
    next,
    baseline[1],
    location("new-location", {
      latitude: null,
      longitude: null,
      coordinatePrecision: "withheld",
    }),
  ]);
  const progress: number[] = [];
  assert.deepEqual(
    applyRun(db, plan, {
      batchSize: 1,
      afterBatch: (p) => {
        progress.push(p.applied);
      },
    }),
    {
      runId: runId(plan),
      status: "complete",
      total: 3,
      applied: 3,
      changed: 2,
    },
  );
  assert.deepEqual(progress, [1, 2, 3]);
  const after = recordState(db, "existing")!;
  assert.equal(after.location.rowid, original.location.rowid);
  assert.equal(after.location.slug, original.location.slug);
  assert.equal(after.location.updated_at, original.location.updated_at);
  assert.deepEqual(
    after.sources.slice(0, 2).map((row) => row.id),
    original.sources.map((row) => row.id),
  );
  assert.deepEqual(after.phenomena.slice(0, 2), original.phenomena);
  assert.equal(snapshot(db, memberTables), members);
  const complete = snapshot(db);
  const checkpoints = snapshot(db, [
    "import_log.runs",
    "import_log.operations",
  ]);
  assert.equal(applyRun(db, plan).changed, 2);
  assert.equal(snapshot(db), complete);
  assert.equal(
    snapshot(db, ["import_log.runs", "import_log.operations"]),
    checkpoints,
  );
  const repeat = run(db, catalog(db));
  assert.equal(applyRun(db, repeat).changed, 0);
  assert.equal(snapshot(db), complete);
  verifyProjection(db);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM locations_fts WHERE locations_fts MATCH 'Research'",
      )
      .get()!.n,
    3,
  );
});

test("an interrupted process resumes its exact on-disk checkpoint without repeating writes", (t) => {
  const f = fixture(t);
  const plan = run(f.db, [
    location("first"),
    location("second"),
    location("third"),
  ]);
  assert.throws(
    () =>
      applyRun(f.db, plan, {
        batchSize: 1,
        afterBatch: () => {
          throw new Error("simulated interruption");
        },
      }),
    /simulated interruption/,
  );
  assert.deepEqual(runProgress(f.db, runId(plan)), {
    runId: runId(plan),
    status: "pending",
    total: 3,
    applied: 1,
    changed: 1,
  });
  const first = recordState(f.db, "first");
  const firstAudit = f.db
    .prepare("SELECT * FROM editorial_audit WHERE location_id = 'first'")
    .all();
  const db = f.reopen();
  const progress = applyRun(db, plan, { batchSize: 1 });
  assert.equal(progress.status, "complete");
  assert.equal(progress.changed, 3);
  assert.deepEqual(recordState(db, "first"), first);
  assert.deepEqual(
    db
      .prepare("SELECT * FROM editorial_audit WHERE location_id = 'first'")
      .all(),
    firstAudit,
  );
  verifyProjection(db);
});

test("bounded batches stop with a resumable checkpoint; changed input, version and plan cannot replace an unfinished run", (t) => {
  const { db } = fixture(t);
  const plan = run(db, [location("first"), location("second")]);
  assert.equal(
    applyRun(db, plan, { batchSize: 1, maxBatches: 1 }).status,
    "pending",
  );
  const before = snapshot(db);
  for (const changed of [
    { ...plan, inputHash: "different-input" },
    { ...plan, importerVersion: "test-adapter-2" },
    { ...plan, operations: [plan.operations[1], plan.operations[0]] },
  ])
    assert.throws(() => applyRun(db, changed), /unfinished run/);
  assert.equal(snapshot(db), before);
  assert.equal(applyRun(db, plan).status, "complete");
});

test("invalid batch limits fail before recording a run or mutating app data", (t) => {
  const { db } = fixture(t);
  const plan = run(db, [location("new-location")]);
  const before = snapshot(db);
  for (const batchSize of [0, -1, 1.5, 501, NaN, Infinity])
    assert.throws(
      () => applyRun(db, plan, { batchSize }),
      /Invalid batch limit/,
    );
  for (const maxBatches of [0, -1, 1.5, NaN])
    assert.throws(
      () => applyRun(db, plan, { maxBatches }),
      /Invalid batch limit/,
    );
  assert.equal(snapshot(db), before);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM import_log.runs").get()!.n,
    0,
  );
});

test("a stored checkpoint with a different engine version or frozen plan cannot resume", (t) => {
  const { db } = fixture(t);
  const plan = run(db, [location("first"), location("second")]);
  applyRun(db, plan, { batchSize: 1, maxBatches: 1 });
  const before = snapshot(db);
  const previous = db
    .prepare("SELECT * FROM import_log.runs WHERE id = ?")
    .get(runId(plan))!;
  for (const [column, value] of [
    ["store_version", "other-engine"],
    ["plan_json", "{}"],
    ["input_hash", "other-input"],
  ]) {
    db.prepare(`UPDATE import_log.runs SET ${column} = ? WHERE id = ?`).run(
      value,
      runId(plan),
    );
    assert.throws(
      () => applyRun(db, plan),
      /Checkpoint version\/input mismatch/,
    );
    assert.equal(snapshot(db), before);
    db.prepare(`UPDATE import_log.runs SET ${column} = ? WHERE id = ?`).run(
      previous[column],
      runId(plan),
    );
  }
  assert.equal(applyRun(db, plan).status, "complete");
});

for (const mutation of ["JSON", "source", "phenomenon", "column"] as const) {
  test(`preflight refuses concurrent ${mutation} changes, including no-op rows, before any import write`, (t) => {
    const { db, baseline } = fixture(t);
    const plan = run(db, [location("new-location"), baseline[0]]);
    if (mutation === "JSON")
      db.prepare(
        "UPDATE locations SET data_json = ? WHERE id = 'existing'",
      ).run(
        JSON.stringify({ ...baseline[0], summary: "A newer editor's work" }),
      );
    if (mutation === "source")
      db.exec(
        "UPDATE location_sources SET title = 'A newer citation' WHERE id = 1",
      );
    if (mutation === "phenomenon")
      db.exec(
        "INSERT INTO location_phenomena VALUES ('existing','Lights and shadows')",
      );
    if (mutation === "column")
      db.exec("UPDATE locations SET city = 'New city' WHERE id = 'existing'");
    const before = snapshot(db);
    assert.throws(() => applyRun(db, plan), /Preflight conflict: existing/);
    assert.equal(snapshot(db), before);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM import_log.runs").get()!.n,
      0,
    );
  });
}

test("resume rejects an edited applied record and a changed pending record without overwriting either", (t) => {
  const { db, baseline } = fixture(t);
  const plan = run(db, [
    location("first"),
    { ...baseline[0], summary: "Imported update." },
  ]);
  applyRun(db, plan, { batchSize: 1, maxBatches: 1 });
  db.exec(
    "UPDATE location_sources SET title = 'Later editor citation' WHERE location_id = 'first'",
  );
  const appliedEdit = snapshot(db);
  assert.throws(() => applyRun(db, plan), /Resume conflict: first/);
  assert.equal(snapshot(db), appliedEdit);
  for (const source of plan.operations[0].after.sources)
    db.prepare(
      "UPDATE location_sources SET title = ? WHERE location_id = 'first' AND url = ?",
    ).run(source.title, source.url);
  db.exec(
    "UPDATE location_phenomena SET phenomenon = 'Objects moving' WHERE location_id = 'existing' AND phenomenon = 'Apparitions'",
  );
  const pendingEdit = snapshot(db);
  assert.throws(
    () => applyRun(db, plan),
    /(?:Resume|Concurrent edit) conflict: existing/,
  );
  assert.equal(snapshot(db), pendingEdit);
  assert.equal(runProgress(db, runId(plan)).applied, 1);
});

test("a database failure rolls back the entire batch and its checkpoints; the same plan resumes after repair", (t) => {
  const { db } = fixture(t);
  const plan = run(db, [location("first"), location("second")]);
  db.exec(
    "CREATE TRIGGER fail_second BEFORE INSERT ON locations WHEN new.id = 'second' BEGIN SELECT RAISE(ABORT,'simulated database failure'); END",
  );
  const before = snapshot(db);
  assert.throws(
    () => applyRun(db, plan, { batchSize: 2 }),
    /simulated database failure/,
  );
  assert.equal(snapshot(db), before);
  assert.deepEqual(runProgress(db, runId(plan)), {
    runId: runId(plan),
    status: "pending",
    total: 2,
    applied: 0,
    changed: 0,
  });
  db.exec("DROP TRIGGER fail_second");
  assert.equal(applyRun(db, plan, { batchSize: 2 }).changed, 2);
  verifyProjection(db);
});

test("rollback exactly restores changed rows and relationships, removes only imported additions/audits and leaves later unrelated work", (t) => {
  const { db, baseline } = fixture(t);
  const original = snapshot(db);
  const oldState = recordState(db, "existing");
  const plan = run(db, [
    {
      ...baseline[0],
      summary: "Imported summary",
      history: "",
      sources: [baseline[0].sources[1]],
      phenomena: ["Apparitions"],
    },
    location("new-location"),
    baseline[1],
  ]);
  applyRun(db, plan, { batchSize: 1 });
  db.exec(
    "INSERT INTO reviews (id,location_id,user_id,body,experience) VALUES ('later-review','existing','member','A later member contribution.','unspecified')",
  );
  db.exec(
    "INSERT INTO editorial_audit (location_id,action) VALUES ('unrelated','unrelated later audit')",
  );
  const laterReview = snapshot(db, ["reviews"]);
  const laterAudit = db
    .prepare(
      "SELECT * FROM editorial_audit WHERE action = 'unrelated later audit'",
    )
    .get();
  assert.equal(rollbackRun(db, runId(plan)).status, "rolled-back");
  assert.deepEqual(recordState(db, "existing"), oldState);
  assert.equal(recordState(db, "new-location"), null);
  assert.equal(snapshot(db, ["reviews"]), laterReview);
  assert.deepEqual(
    db
      .prepare("SELECT * FROM editorial_audit WHERE id = ?")
      .get(laterAudit!.id),
    laterAudit,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM editorial_audit WHERE action LIKE 'nationwide:%'",
      )
      .get()!.n,
    0,
  );
  verifyProjection(db);
  db.exec("DELETE FROM reviews WHERE id = 'later-review'");
  db.prepare("DELETE FROM editorial_audit WHERE id = ?").run(laterAudit!.id);
  assert.equal(snapshot(db), original);
  const rolledBack = snapshot(db);
  assert.equal(rollbackRun(db, runId(plan)).status, "rolled-back");
  assert.equal(snapshot(db), rolledBack);
  assert.throws(() => applyRun(db, plan), /rolled back/);
});

test("a partially applied run can be rolled back without touching its unapplied locations", (t) => {
  const { db, baseline } = fixture(t);
  const before = snapshot(db);
  const plan = run(db, [
    location("first"),
    { ...baseline[0], summary: "Not reached" },
  ]);
  applyRun(db, plan, { batchSize: 1, maxBatches: 1 });
  assert.equal(rollbackRun(db, runId(plan)).status, "rolled-back");
  assert.equal(snapshot(db), before);
});

for (const [name, sql] of [
  [
    "review",
    "INSERT INTO reviews (id,location_id,user_id,body,experience) VALUES ('new-review','new-location','member','New work','unspecified')",
  ],
  [
    "collection",
    "INSERT INTO collection_locations VALUES ('prior-collection','new-location')",
  ],
  [
    "media",
    "INSERT INTO media (id,uploader_id,location_id,storage_key,mime_type,license,alt_text) VALUES ('new-media','member','new-location','new-media-key','image/webp','CC0','New contribution')",
  ],
  [
    "report",
    "INSERT INTO content_reports (id,reporter_id,entity_type,entity_id,reason) VALUES ('report','member','location','new-location','Review this record')",
  ],
  [
    "moderation",
    "INSERT INTO moderation_actions (id,moderator_id,entity_type,entity_id,action,reason) VALUES ('action','member','location','new-location','reviewed','Review complete')",
  ],
  [
    "editorial audit",
    "INSERT INTO editorial_audit (location_id,action) VALUES ('new-location','later-editor-work')",
  ],
] as const) {
  test(`rollback refuses a newly imported location that has acquired a ${name} contribution`, (t) => {
    const { db, baseline } = fixture(t);
    const plan = run(db, [
      { ...baseline[0], summary: "Imported update" },
      location("new-location"),
    ]);
    applyRun(db, plan);
    db.exec(sql);
    const before = snapshot(db);
    assert.throws(() => rollbackRun(db, runId(plan)), /Rollback blocked/);
    assert.equal(snapshot(db), before);
    assert.equal(runProgress(db, runId(plan)).status, "complete");
  });
}

test("rollback refuses edited records and tampered audit ownership atomically", (t) => {
  const { db, baseline } = fixture(t);
  const plan = run(db, [
    { ...baseline[0], summary: "Imported update" },
    location("new-location"),
  ]);
  applyRun(db, plan);
  db.exec(
    "UPDATE location_sources SET title = 'Later work' WHERE location_id = 'existing'",
  );
  const changed = snapshot(db);
  assert.throws(
    () => rollbackRun(db, runId(plan)),
    /Rollback conflict: existing/,
  );
  assert.equal(snapshot(db), changed);
  for (const source of baseline[0].sources)
    db.prepare(
      "UPDATE location_sources SET title = ? WHERE location_id = 'existing' AND url = ?",
    ).run(source.title, source.url);
  db.exec(
    "UPDATE editorial_audit SET action = 'another action' WHERE location_id = 'new-location'",
  );
  const auditChanged = snapshot(db);
  assert.throws(
    () => rollbackRun(db, runId(plan)),
    /Rollback audit conflict: new-location/,
  );
  assert.equal(snapshot(db), auditChanged);
});

test("photo-only patches alter five approved image fields, repeat inertly and rollback while preserving narrative/status/timestamps", (t) => {
  const { db, baseline } = fixture(t);
  const before = snapshot(db);
  const images = {
    image: "/images/verified-photo.webp",
    imageAlt: "Verified historic site exterior",
    imageCredit: "Named creator",
    imageLicense: "CC BY-SA 4.0",
    imageSource: "https://example.org/exact-file",
  };
  const plan = run(db, [{ ...baseline[0], ...images }], "photos");
  assert.equal(applyRun(db, plan).changed, 1);
  assert.deepEqual(
    catalog(db).find((l) => l.id === "existing"),
    { ...baseline[0], ...images },
  );
  const after = snapshot(db);
  applyRun(db, plan);
  assert.equal(snapshot(db), after);
  rollbackRun(db, runId(plan));
  assert.equal(snapshot(db), before);
});

test("independent content and photo runs require reverse rollback order and restore the exact original catalog", (t) => {
  const { db } = fixture(t);
  const before = snapshot(db);
  const content = run(db, [location("new-location")]);
  applyRun(db, content);
  const photo = run(
    db,
    [
      {
        ...catalog(db).find((l) => l.id === "new-location")!,
        image: "/images/new-photo.webp",
      },
    ],
    "photos",
  );
  applyRun(db, photo);
  const afterPhoto = snapshot(db);
  assert.throws(
    () => rollbackRun(db, runId(content)),
    /Rollback conflict: new-location/,
  );
  assert.equal(snapshot(db), afterPhoto);
  assert.equal(rollbackRun(db, runId(photo)).status, "rolled-back");
  assert.equal(rollbackRun(db, runId(content)).status, "rolled-back");
  assert.equal(snapshot(db), before);
  verifyProjection(db);
});

for (const [field, value] of [
  ["summary", "Unrequested narrative replacement"],
  ["status", "archived"],
  ["updatedAt", "2026-10-13T00:00:00.000Z"],
  ["slug", "different-slug"],
  ["latitude", 38.5],
  [
    "sources",
    [
      {
        title: "Replacement",
        url: "https://example.org/replacement",
        kind: "reports",
      },
    ],
  ],
] as const) {
  test(`photo-only patch refuses changing ${field} before creating a checkpoint`, (t) => {
    const { db, baseline } = fixture(t);
    const next = { ...baseline[1], [field]: value } as Location;
    const plan = run(db, [next], "photos");
    const before = snapshot(db);
    assert.throws(
      () => applyRun(db, plan),
      new RegExp(`Photo-only patch changed ${field}`),
    );
    assert.equal(snapshot(db), before);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM import_log.runs").get()!.n,
      0,
    );
  });
}

test("photo patches cannot create records; malformed or duplicate operations cannot begin", (t) => {
  const { db, baseline } = fixture(t);
  assert.throws(
    () => applyRun(db, run(db, [location("new-location")], "photos")),
    /cannot create/,
  );
  const duplicate = run(db, [baseline[0], baseline[0]]);
  assert.throws(() => applyRun(db, duplicate), /Duplicate operation/);
  const badBefore = run(db, [baseline[0]]);
  badBefore.operations[0].before!.summary = "Forged before-image";
  assert.throws(() => applyRun(db, badBefore), /Before-image mismatch/);
  const wrongId = run(db, [baseline[0]]);
  wrongId.operations[0].id = "wrong-id";
  assert.throws(() => applyRun(db, wrongId), /identity changed/);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM import_log.runs").get()!.n,
    0,
  );
});

for (const [name, sql, pattern] of [
  [
    "identity",
    "UPDATE locations SET identity_key = 'wrong-identity' WHERE id = 'existing'",
    /Identity projection mismatch/,
  ],
  [
    "column",
    "UPDATE locations SET city = 'Wrong city' WHERE id = 'existing'",
    /Column projection mismatch/,
  ],
  [
    "sources",
    "DELETE FROM location_sources WHERE id = 1",
    /Source projection mismatch/,
  ],
  [
    "phenomena",
    "DELETE FROM location_phenomena WHERE location_id = 'existing'",
    /Phenomena projection mismatch/,
  ],
] as const) {
  test(`projection verification detects inconsistent ${name}`, (t) => {
    const { db } = fixture(t);
    verifyProjection(db);
    db.exec(sql);
    assert.throws(() => verifyProjection(db), pattern);
  });
}

test("canonical plan identities ignore object-key order but retain array ordering and every input/version field", () => {
  assert.equal(
    digest({ b: [1, 2], a: { d: 4, c: 3 } }),
    digest({ a: { c: 3, d: 4 }, b: [1, 2] }),
  );
  assert.notEqual(digest([1, 2]), digest([2, 1]));
  const plan: ImportRun = {
    importerVersion: "v1",
    inputHash: "input1",
    kind: "content",
    operations: [],
  };
  assert.notEqual(runId(plan), runId({ ...plan, importerVersion: "v2" }));
  assert.notEqual(runId(plan), runId({ ...plan, inputHash: "input2" }));
  assert.notEqual(runId(plan), runId({ ...plan, kind: "photos" }));
});
