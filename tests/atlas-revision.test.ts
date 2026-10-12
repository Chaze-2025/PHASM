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
  atlasAuditAction,
  atlasBaseline,
  atlasRevisionSql,
} from "../scripts/atlas-revision";
import { toSql, validateImport } from "../scripts/import-locations";
import type { Location } from "../shared/types";

const original = validateImport(
  JSON.parse(
    execFileSync("git", ["show", `${atlasBaseline}:content/locations.json`], {
      encoding: "utf8",
    }),
  ),
);
const revised = () =>
  validateImport(JSON.parse(readFileSync("content/locations.json", "utf8")));

function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(toSql(original));
  return db;
}

const catalogTables = [
  "locations",
  "location_sources",
  "location_phenomena",
  "editorial_audit",
] as const;

function snapshot(db: DatabaseSync, tables: readonly string[] = catalogTables) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(
          `SELECT rowid AS snapshot_rowid, * FROM ${table} ORDER BY rowid`,
        )
        .all(),
    ]),
  );
}

function withDatabase(run: (db: DatabaseSync) => void) {
  const db = fixture();
  try {
    run(db);
  } finally {
    db.close();
  }
}

test("atlas import adds 126 and updates four, preserving IDs, sources, reviews, collections and prior audit; exact rerun is inert", () => {
  const after = revised();
  assert.equal(original.length, 10);
  assert.equal(after.length, 136);
  const newRows = after.filter(
    (next) => !original.some((old) => old.id === next.id),
  );
  const changedRows = after.filter((next) => {
    const old = original.find((row) => row.id === next.id);
    return old && JSON.stringify(old) !== JSON.stringify(next);
  });
  assert.equal(newRows.length, 126);
  assert.equal(changedRows.length, 4);

  withDatabase((db) => {
    db.exec(
      "INSERT INTO users (id, auth_subject, display_name) VALUES ('existing-member', 'auth-123', 'Existing Member')",
    );
    db.prepare(
      "INSERT INTO reviews (id, location_id, user_id, rating, body, experience, status) VALUES ('existing-review', ?, 'existing-member', 4, 'My experience remains intact.', 'reported', 'published')",
    ).run(changedRows[0].id);
    db.exec(
      "INSERT INTO review_phenomena (review_id, phenomenon) VALUES ('existing-review', 'Unexplained sounds')",
    );
    db.exec(
      "INSERT INTO review_replies (id, review_id, user_id, body) VALUES ('existing-reply', 'existing-review', 'existing-member', 'A reply remains intact.')",
    );
    db.exec(
      "INSERT INTO review_reactions (review_id, user_id) VALUES ('existing-review', 'existing-member')",
    );
    db.prepare(
      "INSERT INTO media (id, uploader_id, location_id, review_id, storage_key, mime_type, license, alt_text) VALUES ('existing-media', 'existing-member', ?, 'existing-review', 'existing/storage-key', 'image/webp', 'CC0', 'Existing image')",
    ).run(changedRows[0].id);
    db.exec(
      "INSERT INTO collections (id, user_id, title) VALUES ('existing-collection', 'existing-member', 'My collection')",
    );
    db.prepare(
      "INSERT INTO collection_locations (collection_id, location_id) VALUES ('existing-collection', ?)",
    ).run(changedRows[0].id);
    const memberTables = [
      "users",
      "reviews",
      "review_phenomena",
      "review_replies",
      "review_reactions",
      "media",
      "collections",
      "collection_locations",
    ];
    const members = snapshot(db, memberTables);
    const oldRows = db
      .prepare("SELECT rowid, * FROM locations ORDER BY id")
      .all();
    const oldSources = db
      .prepare("SELECT * FROM location_sources ORDER BY id")
      .all();
    const oldAudit = db
      .prepare("SELECT * FROM editorial_audit ORDER BY id")
      .all();
    const sql = atlasRevisionSql(original, after);
    assert.match(sql, /126 additions; 4 updates; 136 final/);
    db.exec(sql);

    const actual = db
      .prepare("SELECT data_json FROM locations ORDER BY id")
      .all()
      .map((row) => JSON.parse(row.data_json as string));
    assert.deepEqual(
      actual,
      [...after].sort((a, b) => a.id.localeCompare(b.id)),
    );
    for (const row of oldRows) {
      const current = db
        .prepare("SELECT rowid, * FROM locations WHERE id = ?")
        .get(row.id);
      assert.equal(current!.rowid, row.rowid, `rowid preserved: ${row.id}`);
      assert.equal(current!.slug, row.slug, `slug preserved: ${row.id}`);
      if (!changedRows.some((next) => next.id === row.id))
        assert.deepEqual(
          current,
          row,
          `unchanged baseline preserved: ${row.id}`,
        );
    }
    for (const source of oldSources) {
      const next = after.find((row) => row.id === source.location_id)!;
      if (
        next.sources.some(
          (entry) => entry.url === source.url && entry.kind === source.kind,
        )
      )
        assert.equal(
          db
            .prepare(
              "SELECT id FROM location_sources WHERE location_id = ? AND url = ? AND kind = ?",
            )
            .get(source.location_id, source.url, source.kind)!.id,
          source.id,
        );
    }
    assert.deepEqual(snapshot(db, memberTables), members);
    for (const audit of oldAudit)
      assert.deepEqual(
        db.prepare("SELECT * FROM editorial_audit WHERE id = ?").get(audit.id),
        audit,
      );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM editorial_audit WHERE action = ?",
        )
        .get(atlasAuditAction)!.count,
      130,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM location_sources").get()!.count,
      after.reduce((count, row) => count + row.sources.length, 0),
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM locations WHERE latitude IS NULL AND longitude IS NULL AND coordinate_precision = 'withheld'",
        )
        .get()!.count,
      after.filter((row) => row.coordinatePrecision === "withheld").length,
    );
    const added = newRows.find((row) => /^[A-Za-z]+/.test(row.name))!;
    const token = added.name.match(/^[A-Za-z]+/)![0];
    const rowid = db
      .prepare("SELECT rowid FROM locations WHERE id = ?")
      .get(added.id)!.rowid;
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM locations_fts WHERE locations_fts MATCH ? AND rowid = ?",
        )
        .get(token, rowid)!.count,
      1,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    const firstResult = snapshot(db, [...catalogTables, ...memberTables]);
    db.exec(sql);
    assert.deepEqual(
      snapshot(db, [...catalogTables, ...memberTables]),
      firstResult,
    );
  });
});

test("atlas guards reject JSON, relational, source and tag drift before any writes", () => {
  const after = revised();
  const sql = atlasRevisionSql(original, after);
  const id = original.at(-1)!.id;
  const corruptions = [
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE locations SET data_json = json_set(data_json, '$.summary', 'Independent editorial change.') WHERE id = ?",
        )
        .run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE locations SET city = 'Changed relational city' WHERE id = ?",
        )
        .run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE location_sources SET title = 'An editor retitled this source' WHERE location_id = ?",
        )
        .run(id),
    (db: DatabaseSync) =>
      db.prepare("DELETE FROM location_sources WHERE location_id = ?").run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "INSERT INTO location_sources (location_id, title, url, kind) VALUES (?, 'New independent source', 'https://example.org/new-research', 'history')",
        )
        .run(id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "INSERT INTO location_phenomena (location_id, phenomenon) VALUES (?, 'Independent editorial tag')",
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
      assert.deepEqual(snapshot(db), beforeAttempt);
    });
  }
});

test("atlas guards reject added-record ID, slug and identity collisions, including a duplicate with an inaccurate stored identity key", () => {
  const after = revised();
  const sql = atlasRevisionSql(original, after);
  const added = after.find(
    (row) => !original.some((old) => old.id === row.id),
  )!;
  const collisions: Location[] = [
    {
      ...structuredClone(added),
      summary: "A different editor created this same ID.",
    },
    {
      ...structuredClone(added),
      id: "unexpected-slug-collision",
      name: "Different name sharing the desired slug",
    },
    {
      ...structuredClone(added),
      id: "unexpected-identity-collision",
      slug: "unexpected-identity-collision",
    },
  ];
  for (const collision of collisions) {
    withDatabase((db) => {
      db.exec(toSql(validateImport([collision])));
      const beforeAttempt = snapshot(db);
      assert.throws(() => db.exec(sql), /malformed JSON/);
      assert.deepEqual(snapshot(db), beforeAttempt);
    });
  }
  withDatabase((db) => {
    const duplicate = {
      ...structuredClone(original[0]),
      id: "unexpected-duplicate",
      slug: "unexpected-duplicate",
      name: "Initially distinct name",
    };
    db.exec(toSql(validateImport([duplicate])));
    db.prepare(
      "UPDATE locations SET name = ?, data_json = json_set(data_json, '$.name', ?) WHERE id = ?",
    ).run(original[0].name, original[0].name, duplicate.id);
    const beforeAttempt = snapshot(db);
    assert.throws(() => db.exec(sql), /malformed JSON/);
    assert.deepEqual(snapshot(db), beforeAttempt);
  });
});

test("atlas rejects drift after import rather than treating an edited target as an idempotent rerun", () => {
  withDatabase((db) => {
    const after = revised();
    const sql = atlasRevisionSql(original, after);
    db.exec(sql);
    db.prepare(
      "UPDATE locations SET data_json = json_set(data_json, '$.summary', 'New edit after import.') WHERE id = ?",
    ).run(after.at(-1)!.id);
    const beforeAttempt = snapshot(db);
    assert.throws(() => db.exec(sql), /malformed JSON/);
    assert.deepEqual(snapshot(db), beforeAttempt);
  });
});

test("atlas reconciles citation changes without replacing retained source rows", () => {
  withDatabase((db) => {
    const after = structuredClone(original);
    const next = after[0];
    next.summary = "Reviewed historical and paranormal research.";
    next.sources[0].title = "Improved title for the same source";
    const removed = next.sources.pop()!;
    next.sources.push({
      title: "New visiting guidance",
      url: "https://example.org/current-visiting-guidance",
      kind: "visiting",
    });
    next.phenomena = ["Lights and shadows"];
    const retained = db
      .prepare(
        "SELECT id FROM location_sources WHERE location_id = ? AND url = ? AND kind = ?",
      )
      .get(next.id, next.sources[0].url, next.sources[0].kind)!.id;
    const sql = atlasRevisionSql(original, after);
    db.exec(sql);
    assert.deepEqual(
      db
        .prepare("SELECT id, title FROM location_sources WHERE id = ?")
        .get(retained),
      Object.assign(Object.create(null), {
        id: retained,
        title: next.sources[0].title,
      }),
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM location_sources WHERE location_id = ? AND url = ? AND kind = ?",
        )
        .get(next.id, removed.url, removed.kind)!.count,
      0,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT phenomenon FROM location_phenomena WHERE location_id = ?",
        )
        .all(next.id)
        .map((row) => row.phenomenon),
      next.phenomena,
    );
    const once = snapshot(db);
    db.exec(sql);
    assert.deepEqual(snapshot(db), once);
  });
});

test("atlas generation rejects removals, changed slugs and duplicate source identities", () => {
  assert.throws(
    () => atlasRevisionSql(original, original.slice(1)),
    /Cannot remove/,
  );
  const changedSlug = structuredClone(original);
  changedSlug[0].slug = "changed-original-slug";
  assert.throws(
    () => atlasRevisionSql(original, changedSlug),
    /Cannot change existing location slug/,
  );
  const duplicateSource = structuredClone(original);
  duplicateSource[0].sources.push({ ...duplicateSource[0].sources[0] });
  assert.throws(
    () => atlasRevisionSql(original, duplicateSource),
    /Duplicate source URL\/kind/,
  );
});

test("atlas CLI creates a private review file and refuses to overwrite it", () => {
  const directory = mkdtempSync(join(tmpdir(), "phasm-atlas-sql-"));
  const output = join(directory, "review.sql");
  try {
    const args = ["--import", "tsx", "scripts/atlas-revision.ts", output];
    const message = execFileSync(process.execPath, args, { encoding: "utf8" });
    assert.match(message, /No database was changed/);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    const sql = readFileSync(output, "utf8");
    assert.equal(sql, atlasRevisionSql(original, revised()));
    assert.throws(
      () => execFileSync(process.execPath, args, { stdio: "pipe" }),
      /Command failed/,
    );
    assert.equal(readFileSync(output, "utf8"), sql);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
