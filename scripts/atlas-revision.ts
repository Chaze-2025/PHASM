import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Location, Source } from "../shared/types";
import { identityKey } from "../worker/validation";
import { validateImport } from "./import-locations";

export const atlasBaseline = "0e980f203650ddbac2d843e66f47194f80735359";
export const atlasAuditAction = "imported:usa-haunted-atlas-130:2026-10-10";

const quote = (value: string | number | null): string =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${value.replace(/'/g, "''")}'`;
const json = (value: unknown) => `json(${quote(JSON.stringify(value))})`;
const sourceKey = (source: Source) => `${source.kind}\n${source.url}`;

function columns(location: Location): Record<string, string | number | null> {
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
  };
}

function sourceMatch(id: string, source: Source): string {
  return `location_id = ${quote(id)} AND url = ${quote(source.url)} AND kind = ${quote(source.kind)}`;
}

/** Match JSON and every relational projection, including source titles and tags. */
function completeState(location: Location): string {
  const id = quote(location.id);
  return [
    ...Object.entries(columns(location)).map(
      ([column, value]) => `l.${column} IS ${quote(value)}`,
    ),
    `json(l.data_json) = ${json(location)}`,
    `(SELECT COUNT(*) FROM location_sources WHERE location_id = ${id}) = ${location.sources.length}`,
    ...location.sources.map(
      (source) =>
        `EXISTS (SELECT 1 FROM location_sources WHERE ${sourceMatch(location.id, source)} AND title = ${quote(source.title)})`,
    ),
    `(SELECT COUNT(*) FROM location_phenomena WHERE location_id = ${id}) = ${location.phenomena.length}`,
    ...location.phenomena.map(
      (tag) =>
        `EXISTS (SELECT 1 FROM location_phenomena WHERE location_id = ${id} AND phenomenon = ${quote(tag)})`,
    ),
  ].join(" AND ");
}

function guard(condition: string, reason: string): string {
  // SQLite raises before the first mutation; D1 also rolls back its import
  // transaction. The deliberately invalid JSON gives each guard a reviewable
  // reason without installing temporary tables, triggers, or user functions.
  return `SELECT CASE WHEN ${condition} THEN 1 ELSE json(${quote(`PHASM atlas revision rejected: ${reason}`)}) END;`;
}

function reconcileChildren(previous: Location | undefined, next: Location) {
  const statements: string[] = [];
  const nextSourceKeys = new Set(next.sources.map(sourceKey));
  for (const source of previous?.sources ?? []) {
    if (!nextSourceKeys.has(sourceKey(source)))
      statements.push(
        `DELETE FROM location_sources WHERE ${sourceMatch(next.id, source)};`,
      );
  }
  for (const source of next.sources) {
    const match = sourceMatch(next.id, source);
    // URL + kind is the database's source identity. Retained sources keep their
    // original row IDs, including when the research improves the source title.
    statements.push(
      `UPDATE location_sources SET title = ${quote(source.title)} WHERE ${match} AND title <> ${quote(source.title)};`,
      `INSERT INTO location_sources (location_id, title, url, kind) SELECT ${quote(next.id)}, ${quote(source.title)}, ${quote(source.url)}, ${quote(source.kind)} WHERE NOT EXISTS (SELECT 1 FROM location_sources WHERE ${match});`,
    );
  }
  for (const tag of previous?.phenomena ?? []) {
    if (!next.phenomena.includes(tag))
      statements.push(
        `DELETE FROM location_phenomena WHERE location_id = ${quote(next.id)} AND phenomenon = ${quote(tag)};`,
      );
  }
  for (const tag of next.phenomena) {
    const match = `location_id = ${quote(next.id)} AND phenomenon = ${quote(tag)}`;
    statements.push(
      `INSERT INTO location_phenomena (location_id, phenomenon) SELECT ${quote(next.id)}, ${quote(tag)} WHERE NOT EXISTS (SELECT 1 FROM location_phenomena WHERE ${match});`,
    );
  }
  return statements;
}

/**
 * Generate SQL only; never connect to a database. The before array is a complete
 * reviewed catalog snapshot, not just the four records receiving new research.
 * Unknown live rows require a fresh review, which also blocks duplicates whose
 * stored identity_key does not agree with their actual name/address fields.
 */
export function atlasRevisionSql(beforeInput: unknown, afterInput: unknown) {
  const before = validateImport(beforeInput);
  const after = validateImport(afterInput);
  const previousById = new Map(
    before.map((location) => [location.id, location]),
  );
  const nextById = new Map(after.map((location) => [location.id, location]));
  const identities = new Map<string, string>();
  const slugs = new Map<string, string>();
  for (const location of [...before, ...after]) {
    for (const [key, mapping, label] of [
      [identityKey(location), identities, "normalized identity"],
      [location.slug, slugs, "slug"],
    ] as const) {
      if (mapping.has(key) && mapping.get(key) !== location.id)
        throw new Error(
          `Cannot reassign ${label} to a different location: ${key}`,
        );
      mapping.set(key, location.id);
    }
    const keys = location.sources.map(sourceKey);
    if (new Set(keys).size !== keys.length)
      throw new Error(`Duplicate source URL/kind: ${location.id}`);
  }
  for (const previous of before) {
    const next = nextById.get(previous.id);
    if (!next)
      throw new Error(`Cannot remove existing location: ${previous.id}`);
    if (previous.slug !== next.slug)
      throw new Error(`Cannot change existing location slug: ${previous.id}`);
  }

  const guards: string[] = [
    guard(
      `NOT EXISTS (SELECT 1 FROM locations WHERE id NOT IN (${after.map((location) => quote(location.id)).join(", ")}))`,
      "unexpected live catalog row; refresh the complete baseline",
    ),
    guard(
      "NOT EXISTS (SELECT identity_key FROM locations GROUP BY identity_key HAVING COUNT(*) > 1)",
      "duplicate live normalized identity",
    ),
  ];
  const changes: string[] = [];
  let added = 0;
  let updated = 0;
  for (const next of after) {
    const previous = previousById.get(next.id);
    const id = quote(next.id);
    const nextState = completeState(next);
    guards.push(
      guard(
        previous
          ? `EXISTS (SELECT 1 FROM locations AS l WHERE l.id = ${id} AND ((${completeState(previous)}) OR (${nextState})))`
          : `(NOT EXISTS (SELECT 1 FROM locations WHERE id = ${id}) OR EXISTS (SELECT 1 FROM locations AS l WHERE l.id = ${id} AND (${nextState})))`,
        `baseline or already-applied state mismatch: ${next.id}`,
      ),
      guard(
        `NOT EXISTS (SELECT 1 FROM locations WHERE id <> ${id} AND (slug = ${quote(next.slug)} OR identity_key = ${quote(identityKey(next))}))`,
        `slug or normalized identity collision: ${next.id}`,
      ),
    );
    if (previous && isDeepStrictEqual(previous, next)) continue;
    if (previous) updated++;
    else added++;
    const needsWrite = previous
      ? `EXISTS (SELECT 1 FROM locations WHERE id = ${id} AND json(data_json) = ${json(previous)})`
      : `NOT EXISTS (SELECT 1 FROM locations WHERE id = ${id})`;
    changes.push(
      `INSERT INTO editorial_audit (location_id, action) SELECT ${id}, ${quote(atlasAuditAction)} WHERE ${needsWrite} AND NOT EXISTS (SELECT 1 FROM editorial_audit WHERE location_id = ${id} AND action = ${quote(atlasAuditAction)});`,
    );
    const values = { ...columns(next), data_json: JSON.stringify(next) };
    changes.push(
      previous
        ? `UPDATE locations SET ${Object.entries(values)
            .filter(([column]) => column !== "id")
            .map(([column, value]) => `${column} = ${quote(value)}`)
            .join(
              ", ",
            )} WHERE id = ${id} AND json(data_json) = ${json(previous)};`
        : `INSERT INTO locations (${Object.keys(values).join(", ")}) SELECT ${Object.values(values).map(quote).join(", ")} WHERE NOT EXISTS (SELECT 1 FROM locations WHERE id = ${id});`,
      ...reconcileChildren(previous, next),
    );
  }
  return [
    "-- PHASM USA Haunted Atlas research revision. Generated SQL; review before applying.",
    `-- Baseline: ${atlasBaseline}. ${before.length} existing; ${added} additions; ${updated} updates; ${after.length} final.`,
    "-- Apply the nullable-coordinate schema migration before this revision.",
    "-- All guards precede all writes. Unexpected catalog changes stop the import.",
    "-- D1 executes the import as a transaction; no explicit BEGIN is needed.",
    "-- Existing location IDs/rowids, unchanged source IDs, member data and prior audit rows are preserved.",
    ...guards,
    "-- Preconditions passed. Begin the reviewed catalog changes.",
    ...changes,
    "",
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length)
    throw new Error(
      "Usage: npx tsx scripts/atlas-revision.ts /path/to/review.sql",
    );
  const before = JSON.parse(
    execFileSync("git", ["show", `${atlasBaseline}:content/locations.json`], {
      encoding: "utf8",
    }),
  );
  const after = JSON.parse(readFileSync("content/locations.json", "utf8"));
  writeFileSync(resolve(output), atlasRevisionSql(before, after), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    `Validated atlas SQL written to ${output}. No database was changed.`,
  );
}
