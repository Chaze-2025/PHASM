import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
  copyFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { prepareWorkspace } from "../scripts/nationwide-import";
import { photoMain } from "../scripts/nationwide-photo-import";
import {
  catalog,
  canonical,
  verifyProjection,
} from "../scripts/nationwide-store";
import { toSql, validateImport } from "../scripts/import-locations";
import { sha256 } from "../scripts/nationwide-verify";
import { PHOTO_FIELDS, type MediaReview } from "../scripts/nationwide-media";

// The exported CLI currently reads argv. Top-level node:test cases are serial;
// restore argv in finally so a failed command cannot contaminate later cases.
async function photo(argv: string[]) {
  const previous = process.argv;
  process.argv = [previous[0], previous[1], ...argv];
  try {
    return await photoMain();
  } finally {
    process.argv = previous;
  }
}

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "phasm-photo-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const assetRoot = join(directory, "source-assets"),
    snapshot = join(directory, "snapshot.sqlite"),
    workspace = join(directory, "workspace");
  mkdirSync(assetRoot);
  const example = validateImport(
    JSON.parse(readFileSync("content/locations.json", "utf8")),
  )[0];
  const baseline = [1, 2].map((index) => ({
    ...example,
    id: `photo-target-${index}`,
    slug: `photo-target-${index}`,
    name: `Photo target ${index}`,
    image: "/images/location-placeholder.svg",
  }));
  const db = new DatabaseSync(snapshot);
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(toSql(baseline));
  db.close();
  await prepareWorkspace(snapshot, workspace);
  const crosswalk = join(directory, "crosswalk.json");
  writeFileSync(
    crosswalk,
    JSON.stringify(
      baseline.map((row) => ({
        research_id: `research-${row.id}`,
        canonical_site_id: row.id,
        preserve_app_id: row.id,
      })),
    ),
  );
  async function review(
    index: number,
    name: string,
    color: string,
    replaceExisting = false,
  ): Promise<MediaReview> {
    const filename = `${name}.jpg`,
      bytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: color },
      })
        .jpeg()
        .toBuffer();
    writeFileSync(join(assetRoot, filename), bytes);
    return {
      researchId: `research-photo-target-${index}`,
      assetPath: filename,
      sha256: sha256(bytes),
      sourcePage: `https://example.org/fixture/${name}`,
      originalAssetUrl: `https://example.org/fixture/${filename}`,
      originalAssetSha256: sha256(bytes),
      sourceEvidenceSha256: sha256("fixture evidence"),
      creator: "Synthetic test fixture",
      license: "CC0 1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution: "Synthetic test fixture",
      reviewedAt: "2026-10-12",
      reviewer: "Automated fixture",
      subjectDescription: `Synthetic ${name} test swatch`,
      exactFileEvidence: "Test bytes match their checksum.",
      rightsEvidence: "Generated test-only RGB swatch.",
      transformations: "None",
      shareAlike: "Not applicable to CC0",
      exactFileVerified: true,
      visualSubjectVerified: true,
      rightsVerified: true,
      replaceExisting,
    };
  }
  const manifest = (version: string, reviews: MediaReview[]) => {
    const file = join(directory, `${version}-manifest.json`);
    writeFileSync(file, JSON.stringify({ patchVersion: version, reviews }));
    return file;
  };
  const planArgs = (command: string, manifestFile: string) => [
    command,
    "--workspace",
    workspace,
    "--manifest",
    manifestFile,
    "--asset-root",
    assetRoot,
    "--crosswalk",
    crosswalk,
  ];
  const actionArgs = (command: string, version: string) => [
    command,
    "--workspace",
    workspace,
    "--patch-version",
    version,
  ];
  const installed = (r: MediaReview) =>
    join(workspace, "assets/images/research", `${r.sha256}.jpg`);
  const current = () => {
    const db = new DatabaseSync(join(workspace, "catalog.sqlite"), {
      readOnly: true,
    });
    try {
      verifyProjection(db);
      return catalog(db);
    } finally {
      db.close();
    }
  };
  return {
    directory,
    assetRoot,
    snapshot,
    workspace,
    baseline,
    review,
    manifest,
    planArgs,
    actionArgs,
    installed,
    current,
  };
}

function nonImage(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !(PHOTO_FIELDS as readonly string[]).includes(key),
    ),
  );
}

test("photo dry-run is read-only; applied frozen plans repeat without changing database bytes, image mtimes or narratives", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "first", "#123456");
  const manifest = f.manifest("photos-v1", [review]),
    database = join(f.workspace, "catalog.sqlite");
  const original = sha256(readFileSync(database)),
    source = sha256(readFileSync(f.snapshot));
  const dry = await photo(f.planArgs("dry-run", manifest));
  assert.equal(dry!.updated, 1);
  assert.equal(dry!.databaseWrites, false);
  assert.equal(existsSync(join(f.workspace, "photo-runs")), false);
  assert.equal(existsSync(join(f.workspace, "assets")), false);
  assert.equal(sha256(readFileSync(database)), original);
  await photo(f.planArgs("plan", manifest));
  const applied = await photo(f.actionArgs("apply", "photos-v1"));
  assert.equal(applied!.changed, 1);
  assert.equal(applied!.status, "complete");
  const first = sha256(readFileSync(database)),
    asset = f.installed(review),
    time = statSync(asset).mtimeMs;
  assert.equal(sha256(readFileSync(asset)), review.sha256);
  assert.deepEqual(
    f
      .current()
      .map((row) => nonImage(row as unknown as Record<string, unknown>)),
    f.baseline.map((row) =>
      nonImage(row as unknown as Record<string, unknown>),
    ),
  );
  const replan = await photo(f.planArgs("plan", manifest));
  assert.equal(replan!.frozenPlanReused, true);
  await photo(f.actionArgs("resume", "photos-v1"));
  assert.equal(sha256(readFileSync(database)), first);
  assert.equal(statSync(asset).mtimeMs, time);
  assert.equal(sha256(readFileSync(f.snapshot)), source);
});

test("two photo versions roll back in reverse order, removing only their own unused assets", async (t) => {
  const f = await fixture(t);
  const one = await f.review(1, "first", "#223344"),
    two = await f.review(1, "second", "#556677", true);
  await photo(f.planArgs("plan", f.manifest("photos-v1", [one])));
  await photo(f.actionArgs("apply", "photos-v1"));
  const afterOne = canonical(f.current());
  await photo(f.planArgs("plan", f.manifest("photos-v2", [two])));
  await photo(f.actionArgs("apply", "photos-v2"));
  const afterTwo = canonical(f.current());
  await assert.rejects(
    photo(f.actionArgs("rollback", "photos-v1")),
    /Rollback conflict/,
  );
  assert.equal(canonical(f.current()), afterTwo);
  assert.ok(existsSync(f.installed(one)) && existsSync(f.installed(two)));
  await photo(f.actionArgs("rollback", "photos-v2"));
  assert.equal(canonical(f.current()), afterOne);
  assert.equal(existsSync(f.installed(two)), false);
  assert.equal(existsSync(f.installed(one)), true);
  await photo(f.actionArgs("rollback", "photos-v1"));
  assert.deepEqual(f.current(), f.baseline);
  assert.equal(existsSync(f.installed(one)), false);
  await photo(f.actionArgs("rollback", "photos-v1"));
  assert.deepEqual(f.current(), f.baseline);
});

test("photo rollback retains matching asset bytes that existed before the import", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "preexisting", "#abcdef");
  const destination = f.installed(review);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(f.assetRoot, review.assetPath), destination);
  const mtime = statSync(destination).mtimeMs;
  await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
  await photo(f.actionArgs("apply", "photos-v1"));
  await photo(f.actionArgs("rollback", "photos-v1"));
  assert.equal(sha256(readFileSync(destination)), review.sha256);
  assert.equal(statSync(destination).mtimeMs, mtime);
  assert.deepEqual(f.current(), f.baseline);
});

test("rollback preserves an imported asset adopted by another current location", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "shared", "#225588");
  await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
  await photo(f.actionArgs("apply", "photos-v1"));
  const sharedPath = f.current()[0].image;
  const db = new DatabaseSync(join(f.workspace, "catalog.sqlite"));
  let laterRecord;
  try {
    laterRecord = { ...catalog(db)[1], image: sharedPath };
    db.prepare("UPDATE locations SET data_json = ? WHERE id = ?").run(
      JSON.stringify(laterRecord),
      laterRecord.id,
    );
  } finally {
    db.close();
  }
  await photo(f.actionArgs("rollback", "photos-v1"));
  assert.deepEqual(f.current()[0], f.baseline[0]);
  assert.deepEqual(f.current()[1], laterRecord);
  assert.equal(sha256(readFileSync(f.installed(review))), review.sha256);
});

for (const mutation of ["missing", "corrupt"] as const) {
  test(`a ${mutation} source asset cannot change database rows after planning`, async (t) => {
    const f = await fixture(t),
      review = await f.review(1, mutation, "#bb3300");
    await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
    const database = join(f.workspace, "catalog.sqlite"),
      before = sha256(readFileSync(database));
    if (mutation === "missing") rmSync(join(f.assetRoot, review.assetPath));
    else writeFileSync(join(f.assetRoot, review.assetPath), "corrupted bytes");
    await assert.rejects(
      photo(f.actionArgs("apply", "photos-v1")),
      /Photo verification changed|Source asset changed/,
    );
    assert.equal(sha256(readFileSync(database)), before);
    assert.equal(existsSync(f.installed(review)), false);
    assert.deepEqual(f.current(), f.baseline);
  });
}

test("partial photo batches resume without replacing already copied assets or repeating completed writes", async (t) => {
  const f = await fixture(t),
    one = await f.review(1, "one", "#332200"),
    two = await f.review(2, "two", "#006644");
  await photo(f.planArgs("plan", f.manifest("photos-v1", [one, two])));
  const partial = await photo([
    ...f.actionArgs("apply", "photos-v1"),
    "--batch-size",
    "1",
    "--max-batches",
    "1",
  ]);
  assert.equal(partial!.status, "pending");
  assert.equal(partial!.applied, 1);
  const mtimes = [one, two].map((r) => statSync(f.installed(r)).mtimeMs);
  const first = f.current()[0];
  const done = await photo([
    ...f.actionArgs("resume", "photos-v1"),
    "--batch-size",
    "1",
  ]);
  assert.equal(done!.status, "complete");
  assert.equal(done!.changed, 2);
  assert.deepEqual(f.current()[0], first);
  assert.deepEqual(
    [one, two].map((r) => statSync(f.installed(r)).mtimeMs),
    mtimes,
  );
  await photo(f.actionArgs("rollback", "photos-v1"));
  assert.deepEqual(f.current(), f.baseline);
});

test("changed installed bytes block rollback before database changes; a corrected asset permits exact rollback", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "guarded", "#997755");
  await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
  await photo(f.actionArgs("apply", "photos-v1"));
  const before = canonical(f.current());
  writeFileSync(f.installed(review), "a later modified asset");
  await assert.rejects(
    photo(f.actionArgs("rollback", "photos-v1")),
    /asset changed.*rollback refused/i,
  );
  assert.equal(canonical(f.current()), before);
  copyFileSync(join(f.assetRoot, review.assetPath), f.installed(review));
  await photo(f.actionArgs("rollback", "photos-v1"));
  assert.deepEqual(f.current(), f.baseline);
});

test("photo CLI cannot mutate the original snapshot through a workspace catalog symlink", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "isolated", "#224466");
  await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
  const before = sha256(readFileSync(f.snapshot)),
    database = join(f.workspace, "catalog.sqlite");
  rmSync(database);
  symlinkSync(f.snapshot, database);
  await assert.rejects(
    photo(f.actionArgs("apply", "photos-v1")),
    /original snapshot|isolated|workspace/i,
  );
  assert.equal(sha256(readFileSync(f.snapshot)), before);
});

test("photo report destinations cannot add files to immutable source assets", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "report-guard", "#cc7755");
  const report = join(f.assetRoot, "report.json");
  await assert.rejects(
    photo([
      ...f.planArgs("dry-run", f.manifest("photos-v1", [review])),
      "--report",
      report,
    ]),
    /input|source|immutable|asset/i,
  );
  assert.equal(existsSync(report), false);
});

test("refusing a rolled-back photo run does not recreate its removed assets", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "rolled-back", "#886644");
  await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
  await photo(f.actionArgs("apply", "photos-v1"));
  await photo(f.actionArgs("rollback", "photos-v1"));
  await assert.rejects(
    photo(f.actionArgs("apply", "photos-v1")),
    /rolled back/,
  );
  assert.equal(existsSync(f.installed(review)), false);
  assert.deepEqual(f.current(), f.baseline);
});

test("a concurrent photo-record edit is rejected before creating asset files", async (t) => {
  const f = await fixture(t),
    review = await f.review(1, "concurrent", "#335599");
  await photo(f.planArgs("plan", f.manifest("photos-v1", [review])));
  const db = new DatabaseSync(join(f.workspace, "catalog.sqlite"));
  try {
    const current = catalog(db)[0];
    db.prepare("UPDATE locations SET data_json = ? WHERE id = ?").run(
      JSON.stringify({ ...current, summary: "A later editor's narrative." }),
      current.id,
    );
  } finally {
    db.close();
  }
  const database = join(f.workspace, "catalog.sqlite"),
    before = sha256(readFileSync(database));
  await assert.rejects(
    photo(f.actionArgs("apply", "photos-v1")),
    /Preflight conflict/,
  );
  assert.equal(existsSync(f.installed(review)), false);
  assert.equal(sha256(readFileSync(database)), before);
});
