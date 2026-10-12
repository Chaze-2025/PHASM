import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Location } from "../shared/types";
import { identityKey, validateLocation } from "../worker/validation";
import { locationStatements } from "../worker/location-sql";

// This engine intentionally has no remote transport. The application schema is
// unchanged; checkpoints and before-images live in an attached local sidecar.
export const STORE_VERSION = "phasm-local-import-1";
export type Row = Record<string, string | number | null>;
export type RecordState = {
  location: Row;
  sources: Row[];
  phenomena: Row[];
} | null;
export interface ImportOperation {
  id: string;
  before: Location | null;
  after: Location;
  expectedState: RecordState;
}
export interface ImportRun {
  importerVersion: string;
  inputHash: string;
  kind: "content" | "photos";
  operations: ImportOperation[];
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const runId = (run: ImportRun) =>
  digest({ storeVersion: STORE_VERSION, ...run });
export function catalog(db: DatabaseSync): Location[] {
  return db
    .prepare("SELECT data_json FROM locations ORDER BY rowid")
    .all()
    .map((row) => JSON.parse(row.data_json as string));
}
export function recordState(db: DatabaseSync, id: string): RecordState {
  const location = db
    .prepare("SELECT rowid AS rowid, * FROM locations WHERE id = ?")
    .get(id) as Row | undefined;
  if (!location) return null;
  return {
    location,
    sources: db
      .prepare(
        "SELECT * FROM location_sources WHERE location_id = ? ORDER BY id",
      )
      .all(id) as Row[],
    phenomena: db
      .prepare(
        "SELECT rowid AS rowid, * FROM location_phenomena WHERE location_id = ? ORDER BY rowid",
      )
      .all(id) as Row[],
  };
}
export function makeOperation(
  db: DatabaseSync,
  after: Location,
): ImportOperation {
  const state = recordState(db, after.id);
  return {
    id: after.id,
    before: state ? JSON.parse(state.location.data_json as string) : null,
    after: validateLocation(after),
    expectedState: state,
  };
}
function equal(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
function assertOperation(op: ImportOperation, kind: ImportRun["kind"]) {
  if (op.id !== op.after.id || (op.before && op.before.id !== op.id))
    throw new Error("Operation identity changed");
  if (!equal(validateLocation(op.after), op.after))
    throw new Error(`Noncanonical location: ${op.id}`);
  if (
    !equal(
      op.before,
      op.expectedState
        ? JSON.parse(op.expectedState.location.data_json as string)
        : null,
    )
  )
    throw new Error(`Before-image mismatch: ${op.id}`);
  if (kind === "photos") {
    if (!op.before) throw new Error("A photo patch cannot create a location");
    const imageKeys = new Set([
      "image",
      "imageAlt",
      "imageCredit",
      "imageLicense",
      "imageSource",
    ]);
    for (const key of Object.keys(op.after) as (keyof Location)[])
      if (!imageKeys.has(key) && !equal(op.before[key], op.after[key]))
        throw new Error(`Photo-only patch changed ${key}`);
  }
}
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function openImportStore(
  databasePath: string,
  journalPath: string,
): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.prepare("ATTACH DATABASE ? AS import_log").run(journalPath);
  // SQLite's super-journal makes the application write and checkpoint atomic.
  // WAL would remove that multi-file guarantee. Keep both files on one disk.
  db.exec(
    "PRAGMA main.journal_mode = DELETE; PRAGMA import_log.journal_mode = DELETE; PRAGMA main.synchronous = FULL; PRAGMA import_log.synchronous = FULL;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS import_log.runs (
    id TEXT PRIMARY KEY, store_version TEXT NOT NULL, importer_version TEXT NOT NULL,
    input_hash TEXT NOT NULL, kind TEXT NOT NULL, plan_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','complete','rolled-back'))
  );
  CREATE TABLE IF NOT EXISTS import_log.operations (
    run_id TEXT NOT NULL, position INTEGER NOT NULL, location_id TEXT NOT NULL,
    before_json TEXT, after_json TEXT, audit_id INTEGER, applied INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(run_id, position)
  );`);
  return db;
}
function ensureRun(db: DatabaseSync, run: ImportRun) {
  const id = runId(run);
  const ids = new Set<string>();
  for (const op of run.operations) {
    assertOperation(op, run.kind);
    if (ids.has(op.id)) throw new Error(`Duplicate operation: ${op.id}`);
    ids.add(op.id);
  }
  const existing = db
    .prepare("SELECT * FROM import_log.runs WHERE id = ?")
    .get(id);
  if (existing) {
    if (
      existing.store_version !== STORE_VERSION ||
      existing.importer_version !== run.importerVersion ||
      existing.input_hash !== run.inputHash ||
      existing.plan_json !== canonical(run)
    )
      throw new Error("Checkpoint version/input mismatch");
    if (existing.status === "rolled-back")
      throw new Error(
        "This run was rolled back; prepare a fresh isolated workspace to reapply",
      );
    return id;
  }
  const other = db
    .prepare("SELECT id FROM import_log.runs WHERE status = 'pending'")
    .get();
  if (other)
    throw new Error(
      "An unfinished run exists; resume it with its exact input and importer version",
    );
  transaction(db, () => {
    // Check every before-image before starting, including no-op preservation rows.
    for (const op of run.operations)
      if (!equal(recordState(db, op.id), op.expectedState))
        throw new Error(`Preflight conflict: ${op.id}`);
    db.prepare(
      "INSERT INTO import_log.runs VALUES (?, ?, ?, ?, ?, ?, 'pending')",
    ).run(
      id,
      STORE_VERSION,
      run.importerVersion,
      run.inputHash,
      run.kind,
      canonical(run),
    );
    const insert = db.prepare(
      "INSERT INTO import_log.operations (run_id, position, location_id, before_json) VALUES (?, ?, ?, ?)",
    );
    run.operations.forEach((op, index) =>
      insert.run(id, index, op.id, canonical(op.expectedState)),
    );
  });
  return id;
}
function upsert(db: DatabaseSync, next: Location, exists: boolean) {
  // Update the row in place. Do not use REPLACE or reset relationship IDs.
  const statement = locationStatements(next, exists)[0];
  db.prepare(statement.sql).run(...statement.params);
  const oldSources = db
    .prepare("SELECT * FROM location_sources WHERE location_id = ? ORDER BY id")
    .all(next.id) as Row[];
  for (const old of oldSources) {
    const source = next.sources.find(
      (s) => s.url === old.url && s.kind === old.kind,
    );
    if (!source)
      db.prepare("DELETE FROM location_sources WHERE id = ?").run(old.id);
    else if (source.title !== old.title)
      db.prepare("UPDATE location_sources SET title = ? WHERE id = ?").run(
        source.title,
        old.id,
      );
  }
  for (const source of next.sources)
    if (!oldSources.some((s) => s.url === source.url && s.kind === source.kind))
      db.prepare(
        "INSERT INTO location_sources (location_id,title,url,kind) VALUES (?,?,?,?)",
      ).run(next.id, source.title, source.url, source.kind);
  const oldTags = db
    .prepare("SELECT phenomenon FROM location_phenomena WHERE location_id = ?")
    .all(next.id);
  for (const old of oldTags)
    if (!next.phenomena.includes(old.phenomenon as string))
      db.prepare(
        "DELETE FROM location_phenomena WHERE location_id = ? AND phenomenon = ?",
      ).run(next.id, old.phenomenon);
  for (const tag of next.phenomena)
    if (!oldTags.some((old) => old.phenomenon === tag))
      db.prepare("INSERT INTO location_phenomena VALUES (?,?)").run(
        next.id,
        tag,
      );
}
export function checkRun(
  db: DatabaseSync,
  run: ImportRun,
  options: { batchSize?: number; maxBatches?: number } = {},
) {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? Infinity;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    (maxBatches !== Infinity &&
      (!Number.isInteger(maxBatches) || maxBatches < 1))
  )
    throw new Error("Invalid batch limit");
  const id = runId(run);
  const ids = new Set<string>();
  for (const op of run.operations) {
    assertOperation(op, run.kind);
    if (ids.has(op.id)) throw new Error(`Duplicate operation: ${op.id}`);
    ids.add(op.id);
  }
  const existing = db
    .prepare("SELECT * FROM import_log.runs WHERE id = ?")
    .get(id);
  if (existing) {
    if (existing.status === "rolled-back")
      throw new Error(
        "This run was rolled back; prepare a fresh isolated workspace to reapply",
      );
    if (
      existing.store_version !== STORE_VERSION ||
      existing.importer_version !== run.importerVersion ||
      existing.input_hash !== run.inputHash ||
      existing.plan_json !== canonical(run)
    )
      throw new Error("Checkpoint version/input mismatch");
    const checkpoints = db
      .prepare(
        "SELECT * FROM import_log.operations WHERE run_id = ? ORDER BY position",
      )
      .all(id);
    if (checkpoints.length !== run.operations.length)
      throw new Error("Checkpoint record count mismatch");
    for (const cp of checkpoints) {
      const expected = cp.applied
        ? JSON.parse(cp.after_json as string)
        : run.operations[Number(cp.position)].expectedState;
      if (!equal(recordState(db, cp.location_id as string), expected))
        throw new Error(`Resume conflict: ${cp.location_id}`);
    }
  } else {
    if (
      db
        .prepare("SELECT id FROM import_log.runs WHERE status = 'pending'")
        .get()
    )
      throw new Error(
        "An unfinished run exists; resume it with its exact input and importer version",
      );
    for (const op of run.operations)
      if (!equal(recordState(db, op.id), op.expectedState))
        throw new Error(`Preflight conflict: ${op.id}`);
  }
  return id;
}
export function applyRun(
  db: DatabaseSync,
  run: ImportRun,
  options: {
    batchSize?: number;
    maxBatches?: number;
    afterBatch?: (progress: RunProgress) => void;
  } = {},
): RunProgress {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? Infinity;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    (maxBatches !== Infinity &&
      (!Number.isInteger(maxBatches) || maxBatches < 1))
  )
    throw new Error("Invalid batch limit");
  checkRun(db, run, options);
  const id = ensureRun(db, run);
  const checkpoints = db
    .prepare(
      "SELECT * FROM import_log.operations WHERE run_id = ? ORDER BY position",
    )
    .all(id);
  // Resume must never skip a subsequently edited row as if it still matched.
  for (const cp of checkpoints)
    if (
      cp.applied &&
      !equal(
        recordState(db, cp.location_id as string),
        JSON.parse(cp.after_json as string),
      )
    )
      throw new Error(`Resume conflict: ${cp.location_id}`);
  const pending = checkpoints.filter((cp) => !cp.applied);
  for (
    let offset = 0, batch = 0;
    offset < pending.length && batch < maxBatches;
    offset += batchSize, batch++
  ) {
    transaction(db, () => {
      for (const cp of pending.slice(offset, offset + batchSize)) {
        const op = run.operations[Number(cp.position)];
        if (!equal(recordState(db, op.id), op.expectedState))
          throw new Error(`Concurrent edit conflict: ${op.id}`);
        let auditId: number | null = null;
        if (!equal(op.before, op.after)) {
          upsert(db, op.after, !!op.before);
          auditId = Number(
            db
              .prepare(
                "INSERT INTO editorial_audit (location_id,action) VALUES (?,?)",
              )
              .run(op.id, `nationwide:${run.kind}:${id}`).lastInsertRowid,
          );
        }
        db.prepare(
          "UPDATE import_log.operations SET after_json = ?, audit_id = ?, applied = 1 WHERE run_id = ? AND position = ?",
        ).run(canonical(recordState(db, op.id)), auditId, id, cp.position);
      }
      const remaining = db
        .prepare(
          "SELECT count(*) AS n FROM import_log.operations WHERE run_id = ? AND applied = 0",
        )
        .get(id)!.n;
      if (!remaining)
        db.prepare(
          "UPDATE import_log.runs SET status = 'complete' WHERE id = ?",
        ).run(id);
    });
    options.afterBatch?.(runProgress(db, id));
  }
  if (!run.operations.length)
    db.prepare(
      "UPDATE import_log.runs SET status = 'complete' WHERE id = ? AND status != 'complete'",
    ).run(id);
  return runProgress(db, id);
}
export interface RunProgress {
  runId: string;
  status: string;
  total: number;
  applied: number;
  changed: number;
}
export function runProgress(db: DatabaseSync, id: string): RunProgress {
  const run = db
    .prepare("SELECT status FROM import_log.runs WHERE id = ?")
    .get(id);
  if (!run) throw new Error("Unknown import run");
  const row = db
    .prepare(
      "SELECT count(*) AS total, coalesce(sum(applied),0) AS applied, count(audit_id) AS changed FROM import_log.operations WHERE run_id = ?",
    )
    .get(id)!;
  return {
    runId: id,
    status: String(run.status),
    total: Number(row.total),
    applied: Number(row.applied),
    changed: Number(row.changed),
  };
}
function assertNoNewDependencies(
  db: DatabaseSync,
  id: string,
  ownAuditId: number | null,
) {
  // Foreign keys plus polymorphic moderation/audit links: do not erase work
  // added after the import, even if the main location row was not edited.
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  for (const table of tables) {
    const name = String(table.name);
    if (["location_sources", "location_phenomena"].includes(name)) continue;
    const escaped = '"' + name.replaceAll('"', '""') + '"';
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${escaped})`).all()) {
      if (fk.table !== "locations") continue;
      const column = '"' + String(fk.from).replaceAll('"', '""') + '"';
      if (
        db
          .prepare(`SELECT 1 FROM ${escaped} WHERE ${column} = ? LIMIT 1`)
          .get(id)
      )
        throw new Error(`Rollback blocked by new ${name} contribution: ${id}`);
    }
  }
  for (const table of ["content_reports", "moderation_actions"])
    if (
      db
        .prepare(
          `SELECT 1 FROM ${table} WHERE entity_type = 'location' AND entity_id = ? LIMIT 1`,
        )
        .get(id)
    )
      throw new Error(`Rollback blocked by new ${table}: ${id}`);
  if (
    db
      .prepare(
        "SELECT 1 FROM editorial_audit WHERE location_id = ? AND id != coalesce(?, -1) LIMIT 1",
      )
      .get(id, ownAuditId)
  )
    throw new Error(`Rollback blocked by later editorial audit: ${id}`);
}
function restoreRow(db: DatabaseSync, table: string, row: Row) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map((k) => row[k]));
}
export function rollbackRun(db: DatabaseSync, id: string): RunProgress {
  const run = db.prepare("SELECT * FROM import_log.runs WHERE id = ?").get(id);
  if (!run) throw new Error("Unknown import run");
  if (run.status === "rolled-back") return runProgress(db, id);
  const checkpoints = db
    .prepare(
      "SELECT * FROM import_log.operations WHERE run_id = ? AND applied = 1 ORDER BY position DESC",
    )
    .all(id);
  transaction(db, () => {
    for (const cp of checkpoints) {
      const current = recordState(db, cp.location_id as string);
      const before: RecordState = JSON.parse(cp.before_json as string);
      if (!equal(current, JSON.parse(cp.after_json as string)))
        throw new Error(`Rollback conflict: ${cp.location_id}`);
      if (cp.audit_id === null) continue;
      const audit = db
        .prepare("SELECT action,location_id FROM editorial_audit WHERE id = ?")
        .get(cp.audit_id);
      if (
        audit?.action !== `nationwide:${run.kind}:${id}` ||
        audit.location_id !== cp.location_id
      )
        throw new Error(`Rollback audit conflict: ${cp.location_id}`);
      if (!before)
        assertNoNewDependencies(
          db,
          cp.location_id as string,
          Number(cp.audit_id),
        );
    }
    for (const cp of checkpoints) {
      if (cp.audit_id === null) continue;
      const before: RecordState = JSON.parse(cp.before_json as string);
      if (!before)
        db.prepare("DELETE FROM locations WHERE id = ?").run(cp.location_id);
      else {
        const keys = Object.keys(before.location).filter(
          (key) => key !== "id" && key !== "rowid",
        );
        db.prepare(
          `UPDATE locations SET ${keys.map((key) => `${key} = ?`).join(",")} WHERE id = ?`,
        ).run(...keys.map((key) => before.location[key]), cp.location_id);
        db.prepare("DELETE FROM location_sources WHERE location_id = ?").run(
          cp.location_id,
        );
        db.prepare("DELETE FROM location_phenomena WHERE location_id = ?").run(
          cp.location_id,
        );
        for (const row of before.sources)
          restoreRow(db, "location_sources", row);
        for (const row of before.phenomena)
          restoreRow(db, "location_phenomena", row);
      }
      db.prepare("DELETE FROM editorial_audit WHERE id = ?").run(cp.audit_id);
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Rollback foreign key check failed");
    db.prepare(
      "UPDATE import_log.runs SET status = 'rolled-back' WHERE id = ?",
    ).run(id);
  });
  return runProgress(db, id);
}

export function verifyProjection(db: DatabaseSync) {
  for (const location of catalog(db)) {
    validateLocation(location);
    const state = recordState(db, location.id)!;
    if (state.location.identity_key !== identityKey(location))
      throw new Error(`Identity projection mismatch: ${location.id}`);
    const expected = locationStatements(location)[0].params;
    const keys = [
      "id",
      "slug",
      "identity_key",
      "name",
      "city",
      "state",
      "country",
      "region",
      "latitude",
      "longitude",
      "category",
      "classification",
      "access",
      "tours",
      "status",
      "coordinate_precision",
      "featured",
      "updated_at",
      "data_json",
    ];
    if (
      !equal(
        keys.slice(0, -1).map((k) => state.location[k]),
        expected.slice(0, -1),
      )
    )
      throw new Error(`Column projection mismatch: ${location.id}`);
    const sources = state.sources
      .map(({ title, url, kind }) => ({ title, url, kind }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b)));
    if (
      !equal(
        sources,
        [...location.sources].sort((a, b) =>
          canonical(a).localeCompare(canonical(b)),
        ),
      )
    )
      throw new Error(`Source projection mismatch: ${location.id}`);
    if (
      !equal(
        state.phenomena.map((p) => p.phenomenon).sort(),
        [...location.phenomena].sort(),
      )
    )
      throw new Error(`Phenomena projection mismatch: ${location.id}`);
  }
  if (
    db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw new Error("SQLite integrity check failed");
}
