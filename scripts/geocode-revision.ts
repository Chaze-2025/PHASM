import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { atlasRevisionSql } from "./atlas-revision";
import { validateImport } from "./import-locations";

export const geocodeBaseline = "9d76541aec32d093a2caa2f3d2a617d73ebe22f3";
export const geocodeAuditAction = "mapped:usa-atlas-75:2026-10-12";

const devilId = "phasm-us-nc-devils-tramping-ground";
const oldDevilNotice =
  "The exact location is withheld, and no authorized public access has been established.";
const newDevilNotice =
  "No authorized public access has been established; a map reference does not grant permission to enter.";

/** Generate a guarded coordinate revision; never connect to a database. */
export function geocodeRevisionSql(beforeInput: unknown, afterInput: unknown) {
  const before = validateImport(beforeInput);
  const after = validateImport(afterInput);
  if (before.length !== 136 || after.length !== 136)
    throw new Error(
      "Coordinate enrichment requires the reviewed 136-record catalog.",
    );
  if (before.filter((row) => row.latitude === null).length !== 75)
    throw new Error(
      "Coordinate enrichment requires exactly 75 unmapped baseline profiles.",
    );
  const byId = new Map(after.map((row) => [row.id, row]));
  for (const previous of before) {
    const next = byId.get(previous.id);
    if (!next) throw new Error(`Missing location: ${previous.id}`);
    if (previous.latitude !== null) {
      if (!isDeepStrictEqual(previous, next))
        throw new Error(`Previously mapped profile changed: ${previous.id}`);
      continue;
    }
    if (next.latitude === null || next.longitude === null)
      throw new Error(`Missing researched coordinates: ${next.id}`);
    let expectedAccessNotes = previous.accessNotes;
    if (previous.id === devilId) {
      if (!previous.accessNotes.endsWith(oldDevilNotice))
        throw new Error(`Unexpected baseline access notice: ${previous.id}`);
      expectedAccessNotes =
        previous.accessNotes.slice(0, -oldDevilNotice.length) + newDevilNotice;
    }
    if (next.accessNotes !== expectedAccessNotes)
      throw new Error(`Unapproved access-note change: ${previous.id}`);
    const protectedFields = (row: typeof next) => {
      const { latitude, longitude, coordinatePrecision, accessNotes, ...rest } =
        row;
      return rest;
    };
    if (!isDeepStrictEqual(protectedFields(previous), protectedFields(next)))
      throw new Error(`Non-geographic profile fields changed: ${previous.id}`);
  }
  return [
    "-- Coordinate revision: fill 75 researched map references; preserve all 61 previously mapped profiles.",
    "-- Only geographic fields and the reviewed Devil's Tramping Ground access notice may change.",
    atlasRevisionSql(before, after, {
      baseline: geocodeBaseline,
      auditAction: geocodeAuditAction,
    }),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length)
    throw new Error(
      "Usage: npx tsx scripts/geocode-revision.ts /private/path/geocodes.sql",
    );
  const before = JSON.parse(
    execFileSync("git", ["show", `${geocodeBaseline}:content/locations.json`], {
      encoding: "utf8",
    }),
  );
  const after = JSON.parse(readFileSync("content/locations.json", "utf8"));
  writeFileSync(output, geocodeRevisionSql(before, after), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    `Validated coordinate update saved to ${output}. No database changed.`,
  );
}
