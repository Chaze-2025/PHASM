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
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { main, prepareWorkspace } from "../scripts/nationwide-import";
import {
  catalog,
  canonical,
  verifyProjection,
} from "../scripts/nationwide-store";
import { toSql, validateImport } from "../scripts/import-locations";
import { sha256 } from "../scripts/nationwide-verify";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "phasm-nationwide-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, "immutable-input"),
    snapshot = join(directory, "snapshot.sqlite");
  const workspace = join(directory, "review-workspace");
  mkdirSync(input);
  const baseline = validateImport(
    JSON.parse(readFileSync("content/locations.json", "utf8")),
  ).slice(0, 1);
  const db = new DatabaseSync(snapshot);
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(toSql(baseline));
  db.close();
  const row = {
    research_id: "phasm-us-va-test-research-site",
    canonical_site_id: "phasm-us-va-test-research-site",
    preserve_app_id: null,
    baseline_match: false,
    state: "Virginia",
    name: "Test research site",
    city: "Sample City",
    source_file: "checkpoints/fixture/virginia/profiles.json",
    record_pointer: "/profiles/0",
  };
  const original = {
    name: row.name,
    city: row.city,
    story:
      "Local tradition attributes unexplained sounds to this historic site.",
    access: "unknown",
  };
  const files: Record<string, string> = {};
  const json = (file: string, value: unknown) => {
    files[file] = JSON.stringify(value);
  };
  json("MANIFEST.json", {
    research_date: "2026-10-12",
    profiles: 1,
    states: 1,
    baseline_identities: 0,
    proposed_additions: 1,
    included_subject_qa_image_files: 0,
  });
  json("index/VALIDATION.json", {
    state_record_total: 1,
    states_indexed: 1,
    baseline_records_indexed: 0,
  });
  json("index/PROFILE_INDEX.json", [row]);
  json("index/GLOBAL_ID_CROSSWALK.json", [row]);
  json("index/BASELINE_CROSSWALK.json", []);
  json("index/ORIGINAL_RECORDS_WITH_INDEX.json", [
    { index: row, original_record: original },
  ]);
  json("index/PHOTO_INDEX.json", [{ research_id: row.research_id }]);
  json("index/INCLUDED_IMAGE_FILES.json", []);
  json("index/SOURCE_INDEX.json", []);
  json("index/EDITORIAL_REVIEW_ITEMS.json", []);
  json("index/DUPLICATE_AUDIT.json", []);
  json("index/BORDER_SITE_AUDIT.json", []);
  json("baseline/repository-catalog-136.json", []);
  json("baseline/phasm_sources.json", { sources: [] });
  json(row.source_file, { profiles: [original] });
  files["index/STATE_COUNTS.csv"] = "state,profiles\nVirginia,1\n";
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(input, file)), { recursive: true });
    writeFileSync(join(input, file), content);
  }
  writeFileSync(
    join(input, "CHECKSUMS.sha256"),
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, content]) => `${sha256(content)}  ${file}\n`)
      .join(""),
  );
  return { directory, input, snapshot, workspace, baseline, row };
}

function tree(root: string): string {
  const files: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[relative(root, path)] = sha256(readFileSync(path));
    }
  };
  visit(root);
  return canonical(files);
}

test("default CLI action validates and plans without creating any files or altering the snapshot/input", async (t) => {
  const f = fixture(t);
  const before = tree(f.directory);
  const result = await main(["--input", f.input, "--snapshot", f.snapshot]);
  assert.equal(result!.databaseWrites, false);
  assert.equal(result!.input, 1);
  assert.equal(result!.created, 1);
  assert.equal(result!.output, 2);
  assert.equal(tree(f.directory), before);
  assert.equal(existsSync(f.workspace), false);
});

test("explicit external reports are deterministic and retain provenance without modifying either input or catalog", async (t) => {
  const f = fixture(t),
    reports = join(f.directory, "reports");
  const inputBefore = tree(f.input),
    databaseBefore = sha256(readFileSync(f.snapshot));
  await main([
    "dry-run",
    "--input",
    f.input,
    "--snapshot",
    f.snapshot,
    "--report-dir",
    reports,
  ]);
  assert.equal(tree(f.input), inputBefore);
  assert.equal(sha256(readFileSync(f.snapshot)), databaseBefore);
  const first = tree(reports);
  await main([
    "validate",
    "--input",
    f.input,
    "--snapshot",
    f.snapshot,
    "--report-dir",
    reports,
  ]);
  assert.equal(tree(reports), first);
  const records = JSON.parse(
    readFileSync(join(reports, "records.json"), "utf8"),
  );
  assert.equal(records[0].researchId, f.row.research_id);
  assert.equal(records[0].nextLocation.status, "draft");
  assert.equal(
    records[0].sidecar.originalRecord.story,
    "Local tradition attributes unexplained sounds to this historic site.",
  );
});

test("report destinations inside immutable input are refused without changing package files", async (t) => {
  const f = fixture(t),
    before = tree(f.input);
  await assert.rejects(
    main([
      "dry-run",
      "--input",
      f.input,
      "--snapshot",
      f.snapshot,
      "--report-dir",
      join(f.input, "reports"),
    ]),
    /input|package|immutable/i,
  );
  assert.equal(tree(f.input), before);
  const alias = join(f.directory, "input-alias");
  symlinkSync(f.input, alias);
  await assert.rejects(
    main([
      "dry-run",
      "--input",
      f.input,
      "--snapshot",
      f.snapshot,
      "--report-dir",
      join(alias, "reports"),
    ]),
    /input|package|immutable/i,
  );
  assert.equal(tree(f.input), before);
});

test("prepare materializes committed WAL writes in independent recoverable database copies", async (t) => {
  const f = fixture(t);
  const source = new DatabaseSync(f.snapshot);
  try {
    source.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    const added = {
      ...f.baseline[0],
      id: "wal-committed",
      slug: "wal-committed",
      name: "Committed WAL site",
      status: "draft" as const,
    };
    source.exec(toSql([added]));
    assert.ok(statSync(`${f.snapshot}-wal`).size > 0);
    await prepareWorkspace(f.snapshot, f.workspace);
    for (const name of ["baseline.sqlite", "catalog.sqlite"]) {
      const copy = new DatabaseSync(join(f.workspace, name), {
        readOnly: true,
      });
      try {
        verifyProjection(copy);
        assert.deepEqual(
          catalog(copy).map((l) => l.id),
          [f.baseline[0].id, "wal-committed"],
        );
      } finally {
        copy.close();
      }
    }
    const metadata = JSON.parse(
      readFileSync(join(f.workspace, "workspace.json"), "utf8"),
    );
    assert.equal(
      metadata.snapshotHash,
      sha256(readFileSync(join(f.workspace, "baseline.sqlite"))),
    );
    assert.equal(metadata.source, f.snapshot);
    assert.equal(statSync(f.workspace).mode & 0o777, 0o700);
    await assert.rejects(
      prepareWorkspace(f.snapshot, f.workspace),
      /already exists/,
    );
  } finally {
    source.close();
  }
});

test("frozen plan, apply, exact resume, report and rollback work end to end in an isolated workspace", async (t) => {
  const f = fixture(t),
    sourceHash = sha256(readFileSync(f.snapshot)),
    inputHash = tree(f.input);
  await main(["prepare", "--snapshot", f.snapshot, "--workspace", f.workspace]);
  const planned = await main([
    "plan",
    "--input",
    f.input,
    "--workspace",
    f.workspace,
  ]);
  assert.equal(planned!.databaseWrites, false);
  assert.equal(existsSync(join(f.workspace, "journal.sqlite")), false);
  const applied = await main([
    "apply",
    "--input",
    f.input,
    "--workspace",
    f.workspace,
    "--batch-size",
    "1",
  ]);
  assert.equal(applied!.status, "complete");
  assert.equal(applied!.changed, 1);
  assert.equal(applied!.catalogCount, 2);
  const file = join(f.workspace, "catalog.sqlite"),
    first = sha256(readFileSync(file));
  const resumed = await main([
    "resume",
    "--input",
    f.input,
    "--workspace",
    f.workspace,
  ]);
  assert.equal(resumed!.status, "complete");
  assert.equal(sha256(readFileSync(file)), first);
  const report = await main(["report", "--workspace", f.workspace]);
  assert.equal(report!.changed, 1);
  const rolledBack = await main(["rollback", "--workspace", f.workspace]);
  assert.equal(rolledBack!.status, "rolled-back");
  assert.equal(rolledBack!.catalogCount, 1);
  const restored = new DatabaseSync(file, { readOnly: true });
  try {
    assert.deepEqual(catalog(restored), f.baseline);
    verifyProjection(restored);
  } finally {
    restored.close();
  }
  assert.equal(sha256(readFileSync(f.snapshot)), sourceHash);
  assert.equal(tree(f.input), inputHash);
});

test("CLI rejects missing, repeated, unknown and unsupported command arguments without filesystem writes", async (t) => {
  const f = fixture(t),
    before = tree(f.directory);
  for (const [args, pattern] of [
    [[], /--input is required/],
    [["--input"], /Missing value/],
    [["--remote"], /Unknown or repeated/],
    [["deploy"], /Unknown command/],
    [["--input", f.input, "--input", f.input], /Unknown or repeated/],
    [["prepare", "--snapshot", f.snapshot], /--workspace is required/],
    [["apply", "--input", f.input], /--workspace is required/],
  ] as const)
    await assert.rejects(main([...args]), pattern);
  assert.equal(tree(f.directory), before);
});
