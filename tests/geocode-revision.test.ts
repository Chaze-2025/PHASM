import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  geocodeAuditAction,
  geocodeBaseline,
  geocodeRevisionSql,
} from "../scripts/geocode-revision";
import { toSql, validateImport } from "../scripts/import-locations";

const original = validateImport(
  JSON.parse(
    execFileSync("git", ["show", `${geocodeBaseline}:content/locations.json`], {
      encoding: "utf8",
    }),
  ),
);
const revised = () =>
  validateImport(JSON.parse(readFileSync("content/locations.json", "utf8")));

const tables = [
  "locations",
  "location_sources",
  "location_phenomena",
  "editorial_audit",
  "users",
  "reviews",
  "review_phenomena",
  "media",
  "collections",
  "collection_locations",
] as const;

function snapshot(db: DatabaseSync) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(`SELECT rowid AS saved_rowid, * FROM ${table} ORDER BY rowid`)
        .all(),
    ]),
  );
}

function withDatabase(run: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort())
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec(toSql(original));
    run(db);
  } finally {
    db.close();
  }
}

test("coordinate revision fills 75 pins, preserves all original IDs, source IDs and member data, and is idempotent", () => {
  const after = revised();
  const previouslyMapped = original.filter((row) => row.latitude !== null);
  const previouslyUnmapped = original.filter((row) => row.latitude === null);
  assert.equal(previouslyMapped.length, 61);
  assert.equal(previouslyUnmapped.length, 75);
  assert.equal(
    after.filter((row) => row.latitude !== null && row.longitude !== null)
      .length,
    136,
  );
  withDatabase((db) => {
    const memberLocation = previouslyUnmapped[0].id;
    db.exec(
      "INSERT INTO users (id, auth_subject, display_name) VALUES ('existing-member', 'auth-existing', 'Existing member')",
    );
    db.prepare(
      "INSERT INTO reviews (id, location_id, user_id, rating, body, experience, status) VALUES ('existing-review', ?, 'existing-member', 4, 'Existing member experience.', 'reported', 'published')",
    ).run(memberLocation);
    db.exec(
      "INSERT INTO review_phenomena (review_id, phenomenon) VALUES ('existing-review', 'Unexplained sounds')",
    );
    db.prepare(
      "INSERT INTO media (id, uploader_id, location_id, review_id, storage_key, mime_type, license, alt_text) VALUES ('existing-image', 'existing-member', ?, 'existing-review', 'images/existing.webp', 'image/webp', 'CC0', 'Existing media')",
    ).run(memberLocation);
    db.exec(
      "INSERT INTO collections (id, user_id, title) VALUES ('existing-collection', 'existing-member', 'My places')",
    );
    db.prepare(
      "INSERT INTO collection_locations (collection_id, location_id) VALUES ('existing-collection', ?)",
    ).run(memberLocation);
    db.prepare(
      "INSERT INTO editorial_audit (location_id, action) VALUES (?, 'reviewed:prior-editorial-action')",
    ).run(memberLocation);
    const before = snapshot(db);
    const sql = geocodeRevisionSql(original, after);
    assert.match(sql, /136 existing; 0 additions; 75 updates; 136 final/);
    assert.match(sql, new RegExp(geocodeBaseline));
    db.exec(sql);
    const once = snapshot(db);
    for (const table of tables.filter(
      (name) => name !== "locations" && name !== "editorial_audit",
    ))
      assert.deepEqual(once[table], before[table], `${table} remains intact`);
    for (const old of before.locations) {
      const current = once.locations.find((row) => row.id === old.id)!;
      assert.equal(current.saved_rowid, old.saved_rowid);
      assert.equal(current.slug, old.slug);
      assert.equal(current.identity_key, old.identity_key);
      if (previouslyMapped.some((row) => row.id === old.id))
        assert.deepEqual(
          current,
          old,
          `previously mapped profile unchanged: ${old.id}`,
        );
    }
    for (const oldAudit of before.editorial_audit)
      assert.deepEqual(
        once.editorial_audit.find((row) => row.id === oldAudit.id),
        oldAudit,
      );
    assert.equal(
      once.editorial_audit.filter((row) => row.action === geocodeAuditAction)
        .length,
      75,
    );
    const expected = [...after].sort((a, b) => a.id.localeCompare(b.id));
    const actual = once.locations
      .map((row) => JSON.parse(row.data_json as string))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(actual, expected);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM locations WHERE status = 'published' AND latitude IS NOT NULL AND longitude IS NOT NULL",
        )
        .get()!.count,
      136,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM locations_fts WHERE locations_fts MATCH 'Whaley'",
        )
        .get()!.count,
      1,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec(sql);
    assert.deepEqual(
      snapshot(db),
      once,
      "exact rerun leaves every row and audit entry unchanged",
    );
  });
});

test("all coordinate guards run before writes and reject JSON, relational, source, tag and missing-row drift", () => {
  const after = revised();
  const sql = geocodeRevisionSql(original, after);
  const id = original.at(-1)!.id;
  const corruptions = [
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE locations SET data_json = json_set(data_json, '$.summary', 'Independent editorial update.') WHERE id = ?",
        )
        .run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE locations SET name = 'Independent relational name' WHERE id = ?",
        )
        .run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE location_sources SET title = 'Independent source correction' WHERE location_id = ?",
        )
        .run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "INSERT INTO location_phenomena (location_id, phenomenon) VALUES (?, 'Independent phenomenon')",
        )
        .run(id),
    (db: DatabaseSync) =>
      db.prepare("DELETE FROM locations WHERE id = ?").run(id),
  ];
  for (const corrupt of corruptions) {
    withDatabase((db) => {
      corrupt(db);
      const beforeAttempt = snapshot(db);
      assert.throws(() => db.exec(sql), /malformed JSON/);
      assert.deepEqual(
        snapshot(db),
        beforeAttempt,
        "failed late guard performs no earlier writes",
      );
    });
  }
  withDatabase((db) => {
    db.exec(sql);
    db.prepare(
      "UPDATE locations SET data_json = json_set(data_json, '$.accessNotes', 'A new edit after mapping.') WHERE id = ?",
    ).run(id);
    const edited = snapshot(db);
    assert.throws(() => db.exec(sql), /malformed JSON/);
    assert.deepEqual(
      snapshot(db),
      edited,
      "edited applied target is rejected without mutation",
    );
  });
});

test("coordinate revision limits changes to 75 geography fields and the exact reviewed Devil's Tramping Ground notice", () => {
  const after = revised();
  const unmappedId = original.find((row) => row.latitude === null)!.id;
  const mappedId = original.find((row) => row.latitude !== null)!.id;
  const devilId = "phasm-us-nc-devils-tramping-ground";
  assert.throws(
    () => geocodeRevisionSql(original.slice(1), after),
    /136-record catalog/,
  );
  const incomplete = structuredClone(after);
  Object.assign(
    incomplete.find((row) => row.id === unmappedId)!,
    { latitude: null, longitude: null, coordinatePrecision: "withheld" },
  );
  assert.throws(
    () => geocodeRevisionSql(original, incomplete),
    /Missing researched coordinates/,
  );
  const movedMapped = structuredClone(after);
  movedMapped.find((row) => row.id === mappedId)!.latitude! += 0.001;
  assert.throws(
    () => geocodeRevisionSql(original, movedMapped),
    /Previously mapped profile changed/,
  );
  const changedSummary = structuredClone(after);
  changedSummary.find((row) => row.id === unmappedId)!.summary =
    "Unrelated editorial change.";
  assert.throws(
    () => geocodeRevisionSql(original, changedSummary),
    /Non-geographic profile fields changed/,
  );
  const editedAccess = structuredClone(after);
  editedAccess.find((row) => row.id === unmappedId)!.accessNotes +=
    " Arbitrary access edit.";
  assert.throws(
    () => geocodeRevisionSql(original, editedAccess),
    /Unapproved access-note change/,
  );
  const editedDevil = structuredClone(after);
  editedDevil.find((row) => row.id === devilId)!.accessNotes =
    "Public entry is allowed.";
  assert.throws(
    () => geocodeRevisionSql(original, editedDevil),
    /Unapproved access-note change/,
  );
  const outdatedDevil = structuredClone(after);
  outdatedDevil.find((row) => row.id === devilId)!.accessNotes = original.find(
    (row) => row.id === devilId,
  )!.accessNotes;
  assert.throws(
    () => geocodeRevisionSql(original, outdatedDevil),
    /Unapproved access-note change/,
  );
  assert.throws(
    () => geocodeRevisionSql(after, after),
    /exactly 75 unmapped baseline profiles/,
  );
});

test("coordinate CLI emits a private review file for the correct baseline and refuses overwrite", () => {
  const directory = mkdtempSync(join(tmpdir(), "phasm-geocode-sql-"));
  const output = join(directory, "review.sql");
  try {
    const args = ["--import", "tsx", "scripts/geocode-revision.ts", output];
    const message = execFileSync(process.execPath, args, { encoding: "utf8" });
    assert.match(message, /No database changed/);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    const sql = readFileSync(output, "utf8");
    assert.equal(sql, geocodeRevisionSql(original, revised()));
    assert.throws(
      () => execFileSync(process.execPath, args, { stdio: "pipe" }),
      /Command failed/,
    );
    assert.equal(readFileSync(output, "utf8"), sql);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
