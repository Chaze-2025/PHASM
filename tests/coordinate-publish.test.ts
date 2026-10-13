import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Location } from "../shared/types";
import { toSql, validateImport } from "../scripts/import-locations";
import {
  buildCoordinatePlan,
  COORDINATE_VERSION,
  type PublicationSnapshot,
} from "../scripts/nationwide-publish";
import type { Row } from "../scripts/nationwide-store";
import { publicationMain } from "../scripts/nationwide-publish-run";

const inputHash = "b".repeat(64);
const sample = validateImport(
  JSON.parse(readFileSync("content/locations.json", "utf8")),
)[0];
const rows = (db: DatabaseSync, table: string) =>
  db.prepare(`SELECT rowid AS rowid, * FROM ${table} ORDER BY rowid`).all();
const snapshot = (db: DatabaseSync): PublicationSnapshot => ({
  locations: rows(db, "locations") as Row[],
  sources: db
    .prepare("SELECT * FROM location_sources ORDER BY id")
    .all() as Row[],
  phenomena: rows(db, "location_phenomena") as Row[],
});
const dataTables = [
  "locations",
  "location_sources",
  "location_phenomena",
  "editorial_audit",
];
const ftsTables = [
  "locations_fts_data",
  "locations_fts_idx",
  "locations_fts_docsize",
  "locations_fts_config",
];
const capture = (db: DatabaseSync, tables = dataTables) =>
  Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
  );
function execute(db: DatabaseSync, sql: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function fixture(
  run: (db: DatabaseSync, before: Location[], after: Location[]) => void,
) {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync("migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
    const before = [
      structuredClone(sample),
      ...[0, 1].map((index): Location => ({
        ...structuredClone(sample),
        id: `unmapped-${index}`,
        slug: `unmapped-${index}`,
        name: `Previously unmapped place ${index}`,
        latitude: null,
        longitude: null,
        coordinatePrecision: "withheld",
        featured: false,
        access: index ? "private" : "unknown",
      })),
    ];
    db.exec(toSql(before));
    db.prepare("UPDATE locations SET data_json = ? WHERE id = ?").run(
      JSON.stringify(before[1], null, 2),
      before[1].id,
    );
    db.prepare(
      "INSERT INTO editorial_audit (location_id,action) VALUES (?,'published:nationwide:previous')",
    ).run(before[1].id);
    const after = structuredClone(before);
    for (const [index, location] of after.slice(1).entries()) {
      location.latitude = 39.5 + index;
      location.longitude = -105.5 - index;
      location.coordinatePrecision = "approximate";
      location.coordinateReference = {
        scope: index ? "county" : "locality",
        label: index ? "County reference point" : "Locality reference point",
        sourceUrl:
          "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html",
      };
    }
    run(db, before, after);
  } finally {
    db.close();
  }
}

test("coordinate patches preserve content, mapped pins, source IDs and FTS while resuming and rerunning without changes", () =>
  fixture((db, before, after) => {
    const baseline = snapshot(db);
    const plan = buildCoordinatePlan(baseline, after, {
      inputHash,
      batchSize: 1,
    });
    assert.deepEqual(
      plan,
      buildCoordinatePlan(baseline, after, { inputHash, batchSize: 1 }),
    );
    assert.equal(plan.version, COORDINATE_VERSION);
    assert.match(plan.auditAction, /^coordinates:nationwide:/);
    assert.equal(plan.created, 0);
    assert.equal(plan.updated, 2);
    assert.equal(plan.unchanged, 1);
    const original = capture(db),
      originalFts = capture(db, ftsTables);
    const originalMapped = rows(db, "locations").find(
      (row) => row.id === sample.id,
    );
    execute(db, plan.preflightSql);
    execute(db, plan.batches[0].applySql);
    const partial = capture(db);
    execute(db, plan.batches[0].applySql);
    assert.deepEqual(capture(db), partial);
    execute(db, plan.preflightSql);
    for (const batch of plan.batches) execute(db, batch.applySql);
    const applied = capture(db);
    execute(db, plan.preflightSql);
    for (const batch of plan.batches) execute(db, batch.applySql);
    assert.deepEqual(capture(db), applied);
    assert.deepEqual(capture(db, ftsTables), originalFts);
    assert.deepEqual(
      rows(db, "locations").find((row) => row.id === sample.id),
      originalMapped,
    );
    for (const key of ["location_sources", "location_phenomena"])
      assert.deepEqual(capture(db)[key], original[key]);
    for (const location of after) {
      const row = db
        .prepare("SELECT * FROM locations WHERE id = ?")
        .get(location.id)!;
      assert.deepEqual(JSON.parse(String(row.data_json)), location);
      assert.equal(row.latitude, location.latitude);
      assert.equal(row.longitude, location.longitude);
      assert.equal(row.coordinate_precision, location.coordinatePrecision);
      const old = before.find((entry) => entry.id === location.id)!;
      for (const key of Object.keys(old) as (keyof Location)[])
        if (!["latitude", "longitude", "coordinatePrecision"].includes(key))
          assert.deepEqual(location[key], old[key]);
    }
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec(
      "INSERT INTO locations_fts(locations_fts, rank) VALUES ('integrity-check', 1)",
    );
  }));

test("coordinate rollback restores raw JSON, null projections and prior audits without deleting later member work", () =>
  fixture((db, _before, after) => {
    const plan = buildCoordinatePlan(snapshot(db), after, { inputHash });
    const original = capture(db),
      originalFts = capture(db, ftsTables);
    for (const batch of plan.batches) execute(db, batch.applySql);
    db.exec(
      "INSERT INTO users (id,auth_subject,display_name) VALUES ('member','private-auth','Member')",
    );
    db.exec(
      "INSERT INTO reviews (id,location_id,user_id,body,experience) VALUES ('review','unmapped-0','member','A new review after mapping','reported')",
    );
    db.exec(
      "INSERT INTO editorial_audit (location_id,action) VALUES ('unmapped-0','member-review:independent')",
    );
    const newAudit = db
      .prepare(
        "SELECT * FROM editorial_audit WHERE action='member-review:independent'",
      )
      .get();
    const memberState = capture(db, ["users", "reviews"]);
    for (const batch of [...plan.batches].reverse())
      execute(db, batch.rollbackSql);
    assert.deepEqual(
      capture(db, ["locations", "location_sources", "location_phenomena"]),
      {
        locations: original.locations,
        location_sources: original.location_sources,
        location_phenomena: original.location_phenomena,
      },
    );
    assert.deepEqual(capture(db, ["users", "reviews"]), memberState);
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM editorial_audit WHERE action='member-review:independent'",
        )
        .get(),
      newAudit,
    );
    for (const audit of original.editorial_audit)
      assert.deepEqual(
        db.prepare("SELECT * FROM editorial_audit WHERE id=?").get(audit.id),
        audit,
      );
    assert.deepEqual(capture(db, ftsTables), originalFts);
    const rolledBack = capture(db);
    for (const batch of [...plan.batches].reverse())
      execute(db, batch.rollbackSql);
    assert.deepEqual(capture(db), rolledBack);
  }));

test("coordinate planning rejects content/media/status/date changes, replacements of mapped pins, absent references and new identities", () =>
  fixture((db, _before, after) => {
    const baseline = snapshot(db);
    for (const [field, value] of [
      ["summary", "A rewritten story"],
      ["image", "/images/unapproved.jpg"],
      ["status", "draft"],
      ["updatedAt", "2026-10-13T00:00:00Z"],
    ] as const) {
      const changed = structuredClone(after);
      (changed[1] as unknown as Record<string, unknown>)[field] = value;
      assert.throws(
        () => buildCoordinatePlan(baseline, changed, { inputHash }),
        /non-coordinate field changed/,
      );
    }
    const mapped = structuredClone(after);
    mapped[0].latitude = Number(mapped[0].latitude) + 0.01;
    assert.throws(
      () => buildCoordinatePlan(baseline, mapped, { inputHash }),
      /existing mapped location/,
    );
    const noReference = structuredClone(after);
    delete noReference[1].coordinateReference;
    assert.throws(
      () => buildCoordinatePlan(baseline, noReference, { inputHash }),
      /sourced reference/,
    );
    const exact = structuredClone(after);
    exact[1].coordinatePrecision = "exact";
    assert.throws(
      () => buildCoordinatePlan(baseline, exact, { inputHash }),
      /approximate/,
    );
    assert.throws(
      () => buildCoordinatePlan(baseline, after.slice(1), { inputHash }),
      /Cannot remove/,
    );
    assert.throws(
      () =>
        buildCoordinatePlan(
          baseline,
          [
            ...after,
            { ...after[1], id: "new", slug: "new", name: "New identity" },
          ],
          { inputHash },
        ),
      /cannot create/,
    );
  }));

test("coordinate guards reject concurrent content, relational coordinates, child changes or missing ownership without partial writes", () => {
  const changes = [
    (db: DatabaseSync) =>
      db.exec(
        "UPDATE locations SET data_json=json_set(data_json,'$.image','/images/editor-photo.jpg') WHERE id='unmapped-1'",
      ),
    (db: DatabaseSync) =>
      db.exec(
        "UPDATE locations SET latitude=42,longitude=-101,coordinate_precision='approximate' WHERE id='unmapped-1'",
      ),
    (db: DatabaseSync) =>
      db.exec(
        "UPDATE location_sources SET title='An editor changed this source' WHERE location_id='unmapped-1'",
      ),
  ];
  for (const change of changes)
    fixture((db, _before, after) => {
      const plan = buildCoordinatePlan(snapshot(db), after, { inputHash });
      change(db);
      const current = capture(db);
      assert.throws(
        () => execute(db, plan.batches[0].applySql),
        /malformed JSON/,
      );
      assert.deepEqual(capture(db), current);
    });
  fixture((db, _before, after) => {
    const plan = buildCoordinatePlan(snapshot(db), after, { inputHash });
    execute(db, plan.batches[0].applySql);
    db.prepare(
      "DELETE FROM editorial_audit WHERE location_id='unmapped-1' AND action=?",
    ).run(plan.auditAction);
    const current = capture(db);
    assert.throws(
      () => execute(db, plan.batches[0].applySql),
      /malformed JSON/,
    );
    assert.throws(
      () => execute(db, plan.batches[0].rollbackSql),
      /malformed JSON/,
    );
    assert.deepEqual(capture(db), current);
  });
});

test("the FTS trigger skips nonindexed updates but keeps search current for every indexed field", () =>
  fixture((db, before) => {
    const id = before[1].id;
    const original = capture(db, ftsTables);
    db.prepare(
      "UPDATE locations SET latitude=39,longitude=-104,coordinate_precision='approximate',data_json=json_set(data_json,'$.summary','Edited prose') WHERE id=?",
    ).run(id);
    assert.deepEqual(capture(db, ftsTables), original);
    const rowid = db
      .prepare("SELECT rowid FROM locations WHERE id=?")
      .get(id)!.rowid;
    for (const [field, token] of [
      ["name", "Uniquenameftstest"],
      ["city", "Uniquecityftstest"],
      ["state", "Uniquestateftstest"],
      ["country", "Uniquecountryftstest"],
    ] as const) {
      db.prepare(
        `UPDATE locations SET ${field}=?,data_json=json_set(data_json,'$.${field}',?) WHERE id=?`,
      ).run(token, token, id);
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM locations_fts WHERE locations_fts MATCH ? AND rowid=?",
          )
          .get(token, rowid)!.n,
        1,
      );
      db.prepare(
        `UPDATE locations SET ${field}=?,data_json=json_set(data_json,'$.${field}',?) WHERE id=?`,
      ).run(before[1][field], before[1][field], id);
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM locations_fts WHERE locations_fts MATCH ? AND rowid=?",
          )
          .get(token, rowid)!.n,
        0,
      );
    }
    const newRowid = Number(rowid) + 1000;
    db.prepare("UPDATE locations SET rowid=? WHERE id=?").run(newRowid, id);
    const matchingRowids = db
      .prepare(
        "SELECT rowid FROM locations_fts WHERE locations_fts MATCH 'Previously'",
      )
      .all()
      .map((row) => row.rowid);
    assert.ok(matchingRowids.includes(newRowid));
    assert.ok(!matchingRowids.includes(rowid));
    db.exec(
      "INSERT INTO locations_fts(locations_fts, rank) VALUES ('integrity-check', 1)",
    );
  }));

test("the coordinate CLI freezes a reviewable plan without executing database changes", () =>
  fixture((db, _before, after) => {
    const directory = mkdtempSync(join(tmpdir(), "phasm-coordinate-plan-"));
    try {
      const baseline = snapshot(db),
        current = capture(db);
      const input = join(directory, "snapshot"),
        output = join(directory, "plan");
      mkdirSync(input);
      for (const [filename, value] of [
        ["locations.json", baseline.locations],
        ["location_sources.json", baseline.sources],
        ["location_phenomena.json", baseline.phenomena],
        ["catalog.json", after],
      ] as const)
        writeFileSync(join(input, filename), JSON.stringify(value));
      const args = [
        "plan-coordinates",
        "--snapshot-dir",
        input,
        "--catalog",
        join(input, "catalog.json"),
        "--input-hash",
        inputHash,
        "--output",
        output,
      ];
      const result = publicationMain(args);
      assert.equal(result.created, 0);
      assert.equal(result.updated, 2);
      assert.equal(result.remoteWrites, false);
      const manifest = JSON.parse(
        readFileSync(join(output, "manifest.json"), "utf8"),
      );
      assert.equal(manifest.plannerVersion, COORDINATE_VERSION);
      assert.match(manifest.auditAction, /^coordinates:nationwide:/);
      assert.match(
        readFileSync(join(output, manifest.batches[0].applyFile), "utf8"),
        /UPDATE locations SET latitude/,
      );
      assert.deepEqual(capture(db), current);
      assert.throws(() => publicationMain(args), /already exists/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }));
