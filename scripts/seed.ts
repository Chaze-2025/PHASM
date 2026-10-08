import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImport, toSql } from "./import-locations";
import { identityKey } from "../worker/validation";

// Explicitly local: this script cannot modify a remote Cloudflare database.
try {
  const locations = validateImport(
    JSON.parse(readFileSync("content/locations.json", "utf8")),
  );
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "phasm-db",
      "--local",
      "--command",
      "SELECT id, slug, identity_key FROM locations",
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  type Identity = { id: string; slug: string; identity_key: string };
  const existing = JSON.parse(output).flatMap(
    (result: { results?: Identity[] }) => result.results ?? [],
  ) as Identity[];
  const ids = new Set(existing.map((row) => row.id));
  const missing = locations.filter((location) => !ids.has(location.id));
  const duplicate = missing.find((location) =>
    existing.some(
      (row) =>
        row.slug === location.slug ||
        row.identity_key === identityKey(location),
    ),
  );
  if (duplicate)
    throw new Error(
      `Existing database identity conflicts with ${duplicate.name}. Resolve the duplicate before seeding; no records were changed.`,
    );
  if (!missing.length)
    console.log(
      "Local catalog is already seeded. Existing editorial records were preserved.",
    );
  else {
    const folder = mkdtempSync(join(tmpdir(), "phasm-seed-"));
    try {
      const filename = join(folder, "seed.sql");
      writeFileSync(filename, toSql(missing));
      execFileSync(
        "npx",
        [
          "wrangler",
          "d1",
          "execute",
          "phasm-db",
          "--local",
          "--file",
          filename,
        ],
        { stdio: "inherit" },
      );
      console.log(
        `Seeded ${missing.length} locations into local D1. Preserved ${locations.length - missing.length} existing catalog records.`,
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
