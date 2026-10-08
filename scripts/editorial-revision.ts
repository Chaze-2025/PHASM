import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateImport } from "./import-locations";

export const editorialBaseline = "8ffeb28e4e36a4fb2169f1fbcbf1d23b2c75e839";
const copyFields = ["summary", "history", "reports"] as const;
const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const json = (value: unknown) => `json(${quote(JSON.stringify(value))})`;

/** Generates reviewable SQL only. It never connects to or writes a database. */
export function editorialRevisionSql(
  beforeInput: unknown,
  afterInput: unknown,
) {
  const before = validateImport(beforeInput);
  const after = validateImport(afterInput);
  if (before.length !== after.length)
    throw new Error("This revision cannot add or remove locations.");
  const guards: string[] = [];
  const changes: string[] = [];
  for (const previous of before) {
    const next = after.find((row) => row.id === previous.id);
    if (!next) throw new Error(`Missing location: ${previous.id}`);
    const protectedFields = (row: typeof previous) => {
      const { summary, history, reports, sources, ...rest } = row;
      return rest;
    };
    if (!isDeepStrictEqual(protectedFields(previous), protectedFields(next)))
      throw new Error(`Non-editorial fields changed: ${previous.id}`);
    if (previous.sources.length !== next.sources.length)
      throw new Error(`Source records must be preserved: ${previous.id}`);
    for (const [index, source] of previous.sources.entries()) {
      const replacement = next.sources[index];
      if (
        source.title !== replacement.title ||
        source.kind !== replacement.kind
      )
        throw new Error(`Source identity changed: ${previous.id}`);
    }
    if (isDeepStrictEqual(previous, next)) continue;
    const id = quote(previous.id);
    const oldJson = json(previous);
    const newJson = json(next);
    const fail = `json(${quote(`PHASM editorial baseline mismatch: ${previous.id}`)})`;
    // Every guard precedes every write. A changed/missing record stops the file
    // before updates; the already-applied revision is safe to run again.
    guards.push(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM locations WHERE id = ${id} AND json(data_json) IN (${oldJson}, ${newJson})) THEN 1 ELSE ${fail} END;`,
    );
    for (const [index, source] of previous.sources.entries()) {
      const replacement = next.sources[index];
      const match = `location_id = ${id} AND title = ${quote(source.title)} AND kind = ${quote(source.kind)}`;
      guards.push(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM location_sources WHERE ${match} AND url IN (${quote(source.url)}, ${quote(replacement.url)})) = 1 THEN 1 ELSE ${fail} END;`,
      );
      if (source.url !== replacement.url)
        changes.push(
          `UPDATE location_sources SET url = ${quote(replacement.url)} WHERE ${match} AND url = ${quote(source.url)};`,
        );
    }
    changes.push(
      `INSERT INTO editorial_audit (location_id, action) SELECT id, 'copy-refined:editorial-voice' FROM locations WHERE id = ${id} AND json(data_json) = ${oldJson};`,
      // JSON_SET names the permitted fields explicitly; relational identity,
      // coordinates, publication, source row IDs and all other metadata remain.
      `UPDATE locations SET data_json = json_set(data_json, ${copyFields.map((key) => `${quote(`$.${key}`)}, ${quote(next[key])}`).join(", ")}, '$.sources', ${json(next.sources)}) WHERE id = ${id} AND json(data_json) = ${oldJson};`,
    );
  }
  return [
    "-- PHASM editorial voice revision. Generated SQL; review before applying.",
    `-- Baseline: ${editorialBaseline}. Apply only to the isolated editorial preview copy.`,
    "-- D1 executes the import as a transaction; no explicit BEGIN is needed.",
    ...guards,
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
      "Usage: npx tsx scripts/editorial-revision.ts /path/to/review.sql",
    );
  const before = JSON.parse(
    execFileSync(
      "git",
      ["show", `${editorialBaseline}:content/locations.json`],
      { encoding: "utf8" },
    ),
  );
  const after = JSON.parse(readFileSync("content/locations.json", "utf8"));
  writeFileSync(output, editorialRevisionSql(before, after), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    `Validated editorial SQL written to ${output}. No database was changed.`,
  );
}
