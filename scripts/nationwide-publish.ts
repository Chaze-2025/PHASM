import { createHash } from "node:crypto";
import type { Location } from "../shared/types";
import { identityKey } from "../worker/validation";
import { validateImport } from "./import-locations";
import { canonical, type Row } from "./nationwide-store";

/** SQL planning only. Transport, approval, backups and checkpoints belong to the caller. */
export const PUBLICATION_VERSION = "phasm-nationwide-publication-1";
export interface PublicationSnapshot {
  locations: Row[];
  sources: Row[];
  phenomena: Row[];
}
export interface PublicationBatch {
  index: number;
  ids: string[];
  applySql: string;
  rollbackSql: string;
  applySha256: string;
  rollbackSha256: string;
}
export interface PublicationPlan {
  version: string;
  revision: string;
  auditAction: string;
  inputHash: string;
  beforeHash: string;
  afterHash: string;
  created: number;
  updated: number;
  unchanged: number;
  preflightSql: string;
  batches: PublicationBatch[];
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const q = (value: string | number | null): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nonfinite SQL number");
    return String(value);
  }
  if (value.includes("\0"))
    throw new Error("NUL is not permitted in SQL values");
  return `'${value.replace(/'/g, "''")}'`;
};
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const photoKeys = new Set([
  "image",
  "imageAlt",
  "imageCredit",
  "imageLicense",
  "imageSource",
]);

function projection(location: Location): Row {
  return {
    id: location.id,
    slug: location.slug,
    identity_key: identityKey(location),
    name: location.name,
    city: location.city,
    state: location.state,
    country: location.country,
    region: location.region,
    latitude: location.latitude,
    longitude: location.longitude,
    category: location.category,
    classification: location.classification,
    access: location.access,
    tours: location.tours,
    status: location.status,
    coordinate_precision: location.coordinatePrecision,
    featured: Number(location.featured),
    updated_at: location.updatedAt,
    data_json: JSON.stringify(location),
  };
}

function rowMatch(alias: string, row: Row, allowed: Set<string>): string {
  return Object.entries(row)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, value]) => {
      if (!allowed.has(column))
        throw new Error(`Unexpected snapshot column: ${column}`);
      return `${alias}.${column} IS ${q(value)}`;
    })
    .join(" AND ");
}
const sourceColumns = new Set(["id", "location_id", "title", "url", "kind"]);
const tagColumns = new Set(["rowid", "location_id", "phenomenon"]);

function state(
  location: Location,
  raw?: { location: Row; sources: Row[]; phenomena: Row[] },
): string {
  const id = q(location.id);
  const values = raw?.location ?? projection(location);
  const sources =
    raw?.sources ??
    location.sources.map((source) => ({
      location_id: location.id,
      ...source,
    }));
  const phenomena =
    raw?.phenomena ??
    location.phenomena.map((phenomenon) => ({
      location_id: location.id,
      phenomenon,
    }));
  return `EXISTS (SELECT 1 FROM locations AS l WHERE ${[
    rowMatch(
      "l",
      values,
      new Set(["rowid", ...Object.keys(projection(location))]),
    ),
    `(SELECT COUNT(*) FROM location_sources WHERE location_id = ${id}) = ${sources.length}`,
    ...sources.map(
      (row) =>
        `EXISTS (SELECT 1 FROM location_sources AS s WHERE ${rowMatch("s", row, sourceColumns)})`,
    ),
    `(SELECT COUNT(*) FROM location_phenomena WHERE location_id = ${id}) = ${phenomena.length}`,
    ...phenomena.map(
      (row) =>
        `EXISTS (SELECT 1 FROM location_phenomena AS p WHERE ${rowMatch("p", row, tagColumns)})`,
    ),
  ].join(" AND ")})`;
}

function guard(condition: string, reason: string): string {
  // No schema changes, temporary tables or user functions. Every guard appears
  // before any writes. A D1 file import is one transaction; failure rolls it back.
  return `-- ${reason.replace(/[\r\n]/g, " ")}\nSELECT CASE WHEN ${condition} THEN 1 ELSE json(${q(`PHASM publication rejected: ${reason}`)}) END AS verified;`;
}

function auditCount(id: string, action: string): string {
  return `(SELECT COUNT(*) FROM editorial_audit WHERE location_id = ${q(id)} AND action = ${q(action)})`;
}

function noDependencies(id: string, slug: string, action: string): string {
  const direct = [
    "reviews",
    "media",
    "collection_locations",
    "editorial_content_locations",
  ].map(
    (table) =>
      `NOT EXISTS (SELECT 1 FROM ${table} WHERE location_id = ${q(id)})`,
  );
  return [
    ...direct,
    ...["content_reports", "moderation_actions"].map(
      (table) =>
        `NOT EXISTS (SELECT 1 FROM ${table} WHERE entity_id IN (${q(id)}, ${q(slug)}))`,
    ),
    // Suggestions have no foreign key. Conservatively preserve any submission
    // containing this public identity, even if its moderation is unfinished.
    `NOT EXISTS (SELECT 1 FROM location_suggestions, json_tree(private_payload_json) AS j WHERE j.type = 'text' AND j.value IN (${q(id)}, ${q(slug)}))`,
    `NOT EXISTS (SELECT 1 FROM editorial_audit WHERE location_id = ${q(id)} AND action <> ${q(action)})`,
  ].join(" AND ");
}

type Operation = {
  id: string;
  applyGuard: string[];
  applyWrites: string[];
  rollbackGuard: string[];
  rollbackWrites: string[];
};

/**
 * Build deterministic, resumable publication and reverse-order rollback batches.
 * New records must be explicitly published by the caller. Existing records may
 * only receive reviewed photo changes; this narrow contract makes exact rollback
 * possible without deleting/recreating any original child or location row.
 */
export function buildPublicationPlan(
  snapshot: PublicationSnapshot,
  afterInput: unknown,
  options: { inputHash: string; batchSize?: number; maxBatchBytes?: number },
): PublicationPlan {
  if (!/^[a-f0-9]{64}$/.test(options.inputHash))
    throw new Error("inputHash must be a SHA-256");
  const batchSize = options.batchSize ?? 50;
  const maxBatchBytes = options.maxBatchBytes ?? 1_000_000;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error("batchSize must be 1–100");
  if (
    !Number.isInteger(maxBatchBytes) ||
    maxBatchBytes < 10_000 ||
    maxBatchBytes > 5_000_000
  )
    throw new Error("maxBatchBytes must be 10,000–5,000,000");
  const before = validateImport(
    snapshot.locations.map((row) => JSON.parse(String(row.data_json))),
  );
  const after = validateImport(afterInput);
  const previous = new Map(before.map((row) => [row.id, row]));
  const nextById = new Map(after.map((row) => [row.id, row]));
  const rawById = new Map(
    snapshot.locations.map((row) => [
      row.id,
      {
        location: row,
        sources: snapshot.sources
          .filter((source) => source.location_id === row.id)
          .sort((a, b) => Number(a.id) - Number(b.id)),
        phenomena: snapshot.phenomena
          .filter((tag) => tag.location_id === row.id)
          .sort((a, b) => canonical(a).localeCompare(canonical(b))),
      },
    ]),
  );
  if (rawById.size !== snapshot.locations.length)
    throw new Error("Duplicate snapshot IDs");
  for (const row of [...snapshot.sources, ...snapshot.phenomena])
    if (!rawById.has(row.location_id))
      throw new Error("Orphan snapshot child row");
  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  if (sourceIds.size !== snapshot.sources.length)
    throw new Error("Duplicate snapshot source IDs");
  for (const old of before) {
    const raw = rawById.get(old.id)!;
    if (!Number.isSafeInteger(raw.location.rowid))
      throw new Error(`Missing snapshot rowid: ${old.id}`);
    const expected = projection(old);
    for (const [column, value] of Object.entries(expected)) {
      if (column !== "data_json" && raw.location[column] !== value)
        throw new Error(`Snapshot projection mismatch: ${old.id}.${column}`);
    }
    const byKey = (a: unknown, b: unknown) =>
      canonical(a).localeCompare(canonical(b));
    const sources = raw.sources
      .map(({ title, url, kind }) => ({ title, url, kind }))
      .sort(byKey);
    if (!equal(sources, [...old.sources].sort(byKey)))
      throw new Error(`Snapshot sources mismatch: ${old.id}`);
    if (
      !equal(
        raw.phenomena.map((p) => p.phenomenon).sort(),
        [...old.phenomena].sort(),
      )
    )
      throw new Error(`Snapshot phenomena mismatch: ${old.id}`);
    const next = nextById.get(old.id);
    if (!next) throw new Error(`Cannot remove existing location: ${old.id}`);
    for (const key of Object.keys(old) as (keyof Location)[])
      if (!photoKeys.has(key) && !equal(old[key], next[key]))
        throw new Error(`Existing non-photo field changed: ${old.id}.${key}`);
  }
  for (const next of after) {
    if (!previous.has(next.id) && next.status !== "published")
      throw new Error(`New location must be explicitly published: ${next.id}`);
    const sourceKeys = next.sources.map((s) => `${s.kind}\n${s.url}`);
    if (new Set(sourceKeys).size !== sourceKeys.length)
      throw new Error(`Duplicate source identity: ${next.id}`);
  }
  // Hash raw before-images, including original JSON bytes/source IDs. Key order
  // and source file ordering do not determine revision identity.
  const beforeHash = sha(
    canonical({
      locations: [...snapshot.locations].sort((a, b) =>
        String(a.id).localeCompare(String(b.id)),
      ),
      sources: [...snapshot.sources].sort(
        (a, b) => Number(a.id) - Number(b.id),
      ),
      phenomena: [...snapshot.phenomena].sort((a, b) =>
        canonical(a).localeCompare(canonical(b)),
      ),
    }),
  );
  const sortedAfter = [...after].sort((a, b) => a.id.localeCompare(b.id));
  const afterHash = sha(canonical(sortedAfter));
  const revision = sha(
    canonical({
      version: PUBLICATION_VERSION,
      inputHash: options.inputHash,
      beforeHash,
      afterHash,
    }),
  );
  const auditAction = `published:nationwide:${revision}`;
  const operations: Operation[] = [];
  const preservationGuards: string[] = [];
  let created = 0,
    updated = 0,
    unchanged = 0;
  for (const next of sortedAfter) {
    const old = previous.get(next.id);
    const raw = rawById.get(next.id);
    if (old && equal(old, next)) {
      unchanged++;
      preservationGuards.push(
        guard(state(old, raw), `preserved baseline mismatch: ${next.id}`),
      );
      continue;
    }
    if (old) updated++;
    else created++;
    const id = q(next.id);
    const absent = `NOT EXISTS (SELECT 1 FROM locations WHERE id = ${id})`;
    const beforeState = old ? state(old, raw) : absent;
    const afterRaw = raw
      ? {
          ...raw,
          location: { ...raw.location, data_json: JSON.stringify(next) },
        }
      : undefined;
    const afterState = state(next, afterRaw);
    const ownership = auditCount(next.id, auditAction);
    const needsWrite = `(${beforeState}) AND ${ownership} = 0`;
    const alreadyApplied = `(${afterState}) AND ${ownership} = 1`;
    const values = projection(next);
    const applyWrites = [
      // Capture ownership before changing the guarded before-image.
      `INSERT INTO editorial_audit (location_id, action) SELECT ${id}, ${q(auditAction)} WHERE ${needsWrite};`,
      old
        ? `UPDATE locations SET data_json = ${q(JSON.stringify(next))} WHERE id = ${id} AND data_json IS ${q(String(raw!.location.data_json))};`
        : `INSERT INTO locations (${Object.keys(values).join(", ")}) SELECT ${Object.values(values).map(q).join(", ")} WHERE ${absent};`,
    ];
    if (!old) {
      for (const source of next.sources)
        applyWrites.push(
          `INSERT INTO location_sources (location_id, title, url, kind) SELECT ${id}, ${q(source.title)}, ${q(source.url)}, ${q(source.kind)} WHERE NOT EXISTS (SELECT 1 FROM location_sources WHERE location_id = ${id} AND url = ${q(source.url)} AND kind = ${q(source.kind)});`,
        );
      for (const phenomenon of next.phenomena)
        applyWrites.push(
          `INSERT INTO location_phenomena (location_id, phenomenon) SELECT ${id}, ${q(phenomenon)} WHERE NOT EXISTS (SELECT 1 FROM location_phenomena WHERE location_id = ${id} AND phenomenon = ${q(phenomenon)});`,
        );
    }
    operations.push({
      id: next.id,
      applyGuard: [
        guard(
          `((${needsWrite}) OR (${alreadyApplied}))`,
          `before-image or owned applied-state mismatch: ${next.id}`,
        ),
        guard(
          `NOT EXISTS (SELECT 1 FROM locations WHERE id <> ${id} AND (slug = ${q(next.slug)} OR identity_key = ${q(identityKey(next))} OR (name = ${q(next.name)} COLLATE NOCASE AND city = ${q(next.city)} COLLATE NOCASE AND state = ${q(next.state)} COLLATE NOCASE AND country = ${q(next.country)} COLLATE NOCASE)))`,
          `identity collision: ${next.id}`,
        ),
      ],
      applyWrites,
      rollbackGuard: [
        guard(
          `((${beforeState}) AND ${ownership} = 0) OR ((${alreadyApplied})${old ? "" : ` AND ${noDependencies(next.id, next.slug, auditAction)}`})`,
          `rollback ownership, exact state or dependent work conflict: ${next.id}`,
        ),
      ],
      rollbackWrites: [
        old
          ? `UPDATE locations SET data_json = ${q(String(raw!.location.data_json))} WHERE id = ${id} AND data_json IS ${q(JSON.stringify(next))} AND ${ownership} = 1;`
          : `DELETE FROM locations WHERE id = ${id} AND ${ownership} = 1;`,
        `DELETE FROM editorial_audit WHERE location_id = ${id} AND action = ${q(auditAction)};`,
      ],
    });
  }
  const header = [
    `-- ${PUBLICATION_VERSION}; revision ${revision}`,
    "-- Generated SQL only. D1 executes each complete file atomically; no explicit BEGIN.",
    "-- Preserve batch order when applying; use reverse batch order for rollback.",
    "-- No member tables, baseline child rows, schema, or unrelated locations are changed.",
  ];
  function render(batch: Operation[], rollback: boolean): string {
    const ordered = rollback ? [...batch].reverse() : batch;
    return [
      ...header,
      ...ordered.flatMap((op) => (rollback ? op.rollbackGuard : op.applyGuard)),
      "-- All preconditions passed. Begin mutations.",
      ...ordered.flatMap((op) =>
        rollback ? op.rollbackWrites : op.applyWrites,
      ),
      "",
    ].join("\n");
  }
  const groups: Operation[][] = [];
  for (const operation of operations) {
    // D1's 100 KB statement limit is separate from import-file size.
    for (const statement of [
      ...operation.applyGuard,
      ...operation.applyWrites,
      ...operation.rollbackGuard,
      ...operation.rollbackWrites,
    ])
      if (Buffer.byteLength(statement) > 95_000)
        throw new Error(`Statement exceeds safe D1 limit: ${operation.id}`);
    let group = groups.at(-1);
    if (
      !group ||
      group.length >= batchSize ||
      Math.max(
        Buffer.byteLength(render([...group, operation], false)),
        Buffer.byteLength(render([...group, operation], true)),
      ) > maxBatchBytes
    ) {
      group = [];
      groups.push(group);
    }
    group.push(operation);
    if (
      Math.max(
        Buffer.byteLength(render(group, false)),
        Buffer.byteLength(render(group, true)),
      ) > maxBatchBytes
    )
      throw new Error(`Single operation exceeds batch size: ${operation.id}`);
  }
  const batches = groups.map((group, index): PublicationBatch => {
    const applySql = render(group, false),
      rollbackSql = render(group, true);
    return {
      index,
      ids: group.map((op) => op.id),
      applySql,
      rollbackSql,
      applySha256: sha(applySql),
      rollbackSha256: sha(rollbackSql),
    };
  });
  return {
    version: PUBLICATION_VERSION,
    revision,
    auditAction,
    inputHash: options.inputHash,
    beforeHash,
    afterHash,
    created,
    updated,
    unchanged,
    preflightSql: [
      ...header,
      ...preservationGuards,
      ...operations.flatMap((op) => op.applyGuard),
      "",
    ].join("\n"),
    batches,
  };
}
