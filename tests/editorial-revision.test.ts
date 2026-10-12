import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  editorialBaseline,
  editorialRevisionSql,
} from "../scripts/editorial-revision";
import { validateImport, toSql } from "../scripts/import-locations";

const original = validateImport(
  JSON.parse(
    execFileSync(
      "git",
      ["show", `${editorialBaseline}:content/locations.json`],
      { encoding: "utf8" },
    ),
  ),
);
const revised = () =>
  validateImport(
    JSON.parse(
      execFileSync(
        "git",
        [
          "show",
          "0e980f203650ddbac2d843e66f47194f80735359:content/locations.json",
        ],
        { encoding: "utf8" },
      ),
    ),
  );
function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(toSql(original));
  return db;
}

test("editorial revision preserves relational identity and sources, remains searchable and is idempotent", () => {
  const db = fixture();
  try {
    const locationColumns = () =>
      db
        .prepare(
          "SELECT id, slug, identity_key, latitude, longitude, status, updated_at FROM locations ORDER BY id",
        )
        .all();
    const sourceIdentity = () =>
      db
        .prepare(
          "SELECT id, location_id, title, kind FROM location_sources ORDER BY id",
        )
        .all();
    const tags = db
      .prepare(
        "SELECT * FROM location_phenomena ORDER BY location_id, phenomenon",
      )
      .all();
    const identities = locationColumns();
    const sources = sourceIdentity();
    const sql = editorialRevisionSql(original, revised());
    db.exec(sql);
    assert.deepEqual(locationColumns(), identities);
    assert.deepEqual(sourceIdentity(), sources);
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM location_phenomena ORDER BY location_id, phenomenon",
        )
        .all(),
      tags,
    );
    const actual = db
      .prepare("SELECT data_json FROM locations ORDER BY id")
      .all()
      .map((row) => JSON.parse(row.data_json as string));
    assert.deepEqual(
      actual,
      revised().sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM locations_fts WHERE locations_fts MATCH 'Stanley'",
        )
        .get()!.count,
      1,
    );
    const audit = db.prepare("SELECT * FROM editorial_audit ORDER BY id").all();
    db.exec(sql);
    assert.deepEqual(
      db.prepare("SELECT * FROM editorial_audit ORDER BY id").all(),
      audit,
    );
  } finally {
    db.close();
  }
});

test("editorial revision rejects broader edits and stops before writes when live copy has drifted", () => {
  const changed = structuredClone(original);
  changed[0].latitude = (changed[0].latitude ?? 0) + 1;
  assert.throws(() => editorialRevisionSql(original, changed), /Non-editorial/);
  const db = fixture();
  try {
    db.prepare(
      "UPDATE locations SET data_json = json_set(data_json, '$.summary', 'An independent editor changed this.') WHERE id = ?",
    ).run(original.at(-1)!.id);
    const before = db.prepare("SELECT * FROM locations ORDER BY id").all();
    const sources = db
      .prepare("SELECT * FROM location_sources ORDER BY id")
      .all();
    assert.throws(
      () => db.exec(editorialRevisionSql(original, revised())),
      /malformed JSON/,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM locations ORDER BY id").all(),
      before,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM location_sources ORDER BY id").all(),
      sources,
    );
  } finally {
    db.close();
  }
});
