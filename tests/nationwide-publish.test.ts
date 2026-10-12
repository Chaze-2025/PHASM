import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Location } from "../shared/types";
import { toSql, validateImport } from "../scripts/import-locations";
import {
  buildPublicationPlan,
  type PublicationSnapshot,
} from "../scripts/nationwide-publish";
import type { Row } from "../scripts/nationwide-store";

const inputHash = "a".repeat(64);
const originals = validateImport(
  JSON.parse(readFileSync("content/locations.json", "utf8")),
).slice(0, 2);
const read = (db: DatabaseSync, table: string) =>
  db.prepare(`SELECT rowid AS rowid, * FROM ${table} ORDER BY rowid`).all();
function baseline(db: DatabaseSync): PublicationSnapshot {
  return {
    locations: read(db, "locations") as Row[],
    sources: db
      .prepare("SELECT * FROM location_sources ORDER BY id")
      .all() as Row[],
    phenomena: read(db, "location_phenomena") as Row[],
  };
}
const tables = [
  "locations",
  "location_sources",
  "location_phenomena",
  "editorial_audit",
  "users",
  "reviews",
  "media",
  "collections",
  "collection_locations",
  "editorial_content_locations",
  "content_reports",
  "moderation_actions",
  "location_suggestions",
];
const snapshot = (db: DatabaseSync) =>
  Object.fromEntries(tables.map((table) => [table, read(db, table)]));
function fixture(fn: (db: DatabaseSync, after: Location[]) => void) {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync("migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort())
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec(toSql(originals));
    // Noncanonical JSON whitespace must survive an exact rollback.
    db.prepare("UPDATE locations SET data_json = ? WHERE id = ?").run(
      JSON.stringify(originals[0], null, 2),
      originals[0].id,
    );
    const after = structuredClone(originals);
    after[0].image = "/images/nationwide/reviewed.jpg";
    after[0].imageCredit = "Reviewed publication photo";
    for (let index = 0; index < 4; index++)
      after.push({
        ...structuredClone(originals[0]),
        id: `nationwide-new-${index}`,
        slug: `nationwide-new-${index}`,
        name: `New published research ${index}`,
        status: "published",
        summary: "Research mentioning O'Brien, with a quoted 'source'.",
        latitude: null,
        longitude: null,
        coordinatePrecision: "withheld",
        featured: false,
      });
    fn(db, after);
  } finally {
    db.close();
  }
}
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

test("publication batches are deterministic and reruns/resume preserve timestamps, IDs and unrelated rows", () =>
  fixture((db, after) => {
    db.exec(
      "INSERT INTO users (id, auth_subject, display_name) VALUES ('member', 'private-auth', 'Member')",
    );
    db.prepare(
      "INSERT INTO reviews (id, location_id, user_id, body, experience) VALUES ('review', ?, 'member', 'Preserve this review', 'reported')",
    ).run(originals[0].id);
    const before = baseline(db);
    const plan = buildPublicationPlan(before, after, {
      inputHash,
      batchSize: 2,
    });
    const again = buildPublicationPlan(
      {
        locations: [...before.locations].reverse(),
        sources: [...before.sources].reverse(),
        phenomena: [...before.phenomena].reverse(),
      },
      [...after].reverse(),
      { inputHash, batchSize: 2 },
    );
    assert.deepEqual(plan, again);
    assert.equal(plan.created, 4);
    assert.equal(plan.updated, 1);
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.batches.length, 3);
    assert.ok(
      plan.batches.every(
        (batch) => !/^\s*(?:BEGIN|COMMIT)\b/m.test(batch.applySql),
      ),
    );
    const originalSources = read(db, "location_sources");
    const originalMembers = read(db, "reviews");
    const originalRowids = new Map(
      read(db, "locations").map((row) => [row.id, row.rowid]),
    );
    const unrelated = {
      ...structuredClone(originals[0]),
      id: "unrelated",
      slug: "unrelated",
      name: "Unrelated independently created site",
    };
    db.exec(toSql([unrelated]));
    const unrelatedState = read(db, "locations").find(
      (row) => row.id === unrelated.id,
    );
    execute(db, plan.preflightSql);
    execute(db, plan.batches[0].applySql);
    // A lost acknowledgement resumes with the same input and ownership marker.
    const partial = snapshot(db);
    execute(db, plan.batches[0].applySql);
    assert.deepEqual(snapshot(db), partial);
    execute(db, plan.preflightSql);
    for (const batch of plan.batches) execute(db, batch.applySql);
    const first = snapshot(db);
    execute(db, plan.preflightSql);
    for (const batch of plan.batches) execute(db, batch.applySql);
    assert.deepEqual(snapshot(db), first);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM editorial_audit WHERE action = ?")
        .get(plan.auditAction)!.n,
      5,
    );
    for (const row of originalSources)
      assert.deepEqual(
        read(db, "location_sources").find((source) => source.id === row.id),
        row,
      );
    for (const [id, rowid] of originalRowids)
      assert.equal(
        db.prepare("SELECT rowid FROM locations WHERE id = ?").get(id)!.rowid,
        rowid,
      );
    assert.deepEqual(read(db, "reviews"), originalMembers);
    assert.deepEqual(
      read(db, "locations").find((row) => row.id === unrelated.id),
      unrelatedState,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec(
      "INSERT INTO locations_fts(locations_fts, rank) VALUES ('integrity-check', 1)",
    );
  }));

test("guards reject concurrent JSON, projection, source IDs/titles, tags and ID/slug/identity collisions before writes", () => {
  const mutations = [
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE locations SET data_json = json_set(data_json, '$.summary', 'Concurrent edit') WHERE id = ?",
        )
        .run(originals[0].id),
    (db: DatabaseSync) =>
      db
        .prepare("UPDATE locations SET city = 'Concurrent city' WHERE id = ?")
        .run(originals[0].id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE location_sources SET title = 'Concurrent title' WHERE location_id = ?",
        )
        .run(originals[0].id),
    (db: DatabaseSync) =>
      db
        .prepare(
          "UPDATE location_sources SET id = id + 10000 WHERE location_id = ?",
        )
        .run(originals[0].id),
    (db: DatabaseSync) =>
      db
        .prepare("DELETE FROM location_phenomena WHERE location_id = ?")
        .run(originals[0].id),
    (db: DatabaseSync, after: Location[]) =>
      db.exec(
        toSql([{ ...after[2], summary: "Different independent record" }]),
      ),
    (db: DatabaseSync, after: Location[]) =>
      db.exec(
        toSql([{ ...after[2], id: "collision", name: "Different name" }]),
      ),
    (db: DatabaseSync, after: Location[]) =>
      db.exec(toSql([{ ...after[2], id: "collision", slug: "collision" }])),
    (db: DatabaseSync, after: Location[]) => {
      db.exec(
        toSql([
          {
            ...after[2],
            id: "collision",
            slug: "collision",
            name: "Initially different",
          },
        ]),
      );
      db.prepare("UPDATE locations SET name = ? WHERE id = 'collision'").run(
        after[2].name,
      );
    },
  ];
  for (const mutate of mutations)
    fixture((db, after) => {
      const plan = buildPublicationPlan(baseline(db), after, {
        inputHash,
        batchSize: 10,
      });
      mutate(db, after);
      const before = snapshot(db);
      assert.throws(() => execute(db, plan.preflightSql), /malformed JSON/);
      assert.throws(
        () => execute(db, plan.batches[0].applySql),
        /malformed JSON/,
      );
      assert.deepEqual(snapshot(db), before);
    });
});

test("an unexpected write-time failure rolls back every record and audit in that batch", () =>
  fixture((db, after) => {
    const plan = buildPublicationPlan(baseline(db), after, {
      inputHash,
      batchSize: 10,
    });
    db.exec(
      "CREATE TRIGGER fail_second BEFORE INSERT ON locations WHEN new.id = 'nationwide-new-1' BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END",
    );
    const before = snapshot(db);
    assert.throws(
      () => execute(db, plan.batches[0].applySql),
      /simulated interruption/,
    );
    assert.deepEqual(snapshot(db), before);
    db.exec("DROP TRIGGER fail_second");
    execute(db, plan.batches[0].applySql);
    assert.equal(read(db, "locations").length, after.length);
  }));

test("rollback restores original bytes/source IDs, preserves member work and prior audits, and is itself repeatable", () =>
  fixture((db, after) => {
    const plan = buildPublicationPlan(baseline(db), after, {
      inputHash,
      batchSize: 2,
    });
    const before = snapshot(db);
    for (const batch of plan.batches) execute(db, batch.applySql);
    // New member work on an existing baseline place must survive rollback.
    db.exec(
      "INSERT INTO users (id, auth_subject, display_name) VALUES ('member', 'private-auth', 'Member')",
    );
    db.prepare(
      "INSERT INTO reviews (id, location_id, user_id, body, experience) VALUES ('new-baseline-review', ?, 'member', 'Independent member work', 'reported')",
    ).run(originals[0].id);
    const members = read(db, "reviews");
    for (const batch of [...plan.batches].reverse())
      execute(db, batch.rollbackSql);
    for (const table of [
      "locations",
      "location_sources",
      "location_phenomena",
      "editorial_audit",
    ])
      assert.deepEqual(read(db, table), before[table]);
    assert.deepEqual(read(db, "reviews"), members);
    const once = snapshot(db);
    for (const batch of [...plan.batches].reverse())
      execute(db, batch.rollbackSql);
    assert.deepEqual(snapshot(db), once);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  }));

test("rollback of newly published records blocks reviews, media, collections, editorial links, reports, moderation, suggestions and independent audits", () => {
  const references = [
    "INSERT INTO reviews (id,location_id,user_id,body,experience) VALUES ('review','nationwide-new-0','member','New member work','reported')",
    "INSERT INTO media (id,location_id,storage_key,mime_type,license,alt_text) VALUES ('media','nationwide-new-0','key','image/jpeg','CC0','New upload')",
    "INSERT INTO collections (id,user_id,title) VALUES ('collection','member','Collection'); INSERT INTO collection_locations VALUES ('collection','nationwide-new-0')",
    "INSERT INTO editorial_content (id,slug,kind,title,body) VALUES ('content','content','trail','Trail','Body'); INSERT INTO editorial_content_locations VALUES ('content','nationwide-new-0',0)",
    "INSERT INTO content_reports (id,entity_type,entity_id,reason) VALUES ('report','location','nationwide-new-0','Report')",
    "INSERT INTO moderation_actions (id,moderator_id,entity_type,entity_id,action,reason) VALUES ('moderation','member','location','nationwide-new-0','reviewed','Review')",
    "INSERT INTO location_suggestions (id,user_id,private_payload_json) VALUES ('suggestion','member','{\"locationId\":\"nationwide-new-0\"}')",
    "INSERT INTO editorial_audit (location_id,action) VALUES ('nationwide-new-0','independent:editor-review')",
  ];
  for (const reference of references)
    fixture((db, after) => {
      const plan = buildPublicationPlan(baseline(db), after, {
        inputHash,
        batchSize: 10,
      });
      execute(db, plan.batches[0].applySql);
      db.exec(
        "INSERT INTO users (id,auth_subject,display_name) VALUES ('member','private-auth','Member')",
      );
      db.exec(reference);
      const before = snapshot(db);
      assert.throws(
        () => execute(db, plan.batches[0].rollbackSql),
        /malformed JSON/,
      );
      assert.deepEqual(snapshot(db), before);
    });
});

test("owned applied state is required for resume and rollback; concurrent after-state edits are never overwritten", () =>
  fixture((db, after) => {
    const plan = buildPublicationPlan(baseline(db), after, {
      inputHash,
      batchSize: 10,
    });
    execute(db, plan.batches[0].applySql);
    db.prepare(
      "DELETE FROM editorial_audit WHERE location_id = ? AND action = ?",
    ).run("nationwide-new-0", plan.auditAction);
    const withoutOwnership = snapshot(db);
    assert.throws(
      () => execute(db, plan.batches[0].applySql),
      /malformed JSON/,
    );
    assert.throws(
      () => execute(db, plan.batches[0].rollbackSql),
      /malformed JSON/,
    );
    assert.deepEqual(snapshot(db), withoutOwnership);
    db.prepare(
      "INSERT INTO editorial_audit (location_id,action) VALUES (?,?)",
    ).run("nationwide-new-0", plan.auditAction);
    db.prepare(
      "UPDATE locations SET data_json = json_set(data_json, '$.summary', 'New editorial work') WHERE id = ?",
    ).run("nationwide-new-0");
    const edited = snapshot(db);
    assert.throws(
      () => execute(db, plan.batches[0].applySql),
      /malformed JSON/,
    );
    assert.throws(
      () => execute(db, plan.batches[0].rollbackSql),
      /malformed JSON/,
    );
    assert.deepEqual(snapshot(db), edited);
  }));

test("planning refuses draft additions, baseline non-photo mutations, removed records, duplicate source identities and invalid snapshots", () =>
  fixture((db, after) => {
    const before = baseline(db);
    const plan = (rows: Location[]) =>
      buildPublicationPlan(before, rows, { inputHash });
    const draft = structuredClone(after);
    draft[2].status = "draft";
    assert.throws(() => plan(draft), /explicitly published/);
    const altered = structuredClone(after);
    altered[0].summary = "A different story";
    assert.throws(() => plan(altered), /non-photo field changed/);
    assert.throws(() => plan(after.slice(1)), /Cannot remove/);
    const duplicate = structuredClone(after);
    duplicate[2].sources.push(duplicate[2].sources[0]);
    assert.throws(() => plan(duplicate), /Duplicate source identity/);
    const broken = structuredClone(before);
    broken.sources[0].title = "Different from JSON";
    assert.throws(
      () => buildPublicationPlan(broken, after, { inputHash }),
      /sources mismatch/,
    );
    assert.throws(
      () => buildPublicationPlan(before, after, { inputHash: "not-a-hash" }),
      /SHA-256/,
    );
    assert.throws(
      () => buildPublicationPlan(before, after, { inputHash, batchSize: 1000 }),
      /batchSize/,
    );
  }));
