import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  resolveJsonPointer,
  safePackagePath,
  sha256,
  verifyNationwidePackage,
} from "../scripts/nationwide-verify";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "phasm-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const indexed = [
    {
      research_id: "baseline",
      canonical_site_id: "baseline",
      preserve_app_id: "preserved",
      state: "State A",
      source_file: "records.json",
      record_pointer: "/a~1b/~0profiles/0",
    },
    {
      research_id: "addition",
      canonical_site_id: "addition",
      preserve_app_id: null,
      state: "State B",
      source_file: "records.json",
      record_pointer: "/a~1b/~0profiles/1",
    },
  ];
  const records = [
    { research_id: "baseline", story: "Preserved source." },
    { research_id: "addition", story: "Attributed report." },
  ];
  const image = Buffer.from("image hash fixture, not an actual decoded photo");
  const files: Record<string, string | Buffer> = {};
  const json = (path: string, value: unknown) => {
    files[path] = JSON.stringify(value);
  };
  json("MANIFEST.json", {
    profiles: 2,
    states: 2,
    baseline_identities: 1,
    proposed_additions: 1,
    included_subject_qa_image_files: 1,
  });
  json("index/VALIDATION.json", {
    state_record_total: 2,
    states_indexed: 2,
    baseline_records_indexed: 1,
  });
  json("index/PROFILE_INDEX.json", indexed);
  json(
    "index/ORIGINAL_RECORDS_WITH_INDEX.json",
    indexed.map((row, index) => ({
      index: row,
      original_record: records[index],
    })),
  );
  json("index/GLOBAL_ID_CROSSWALK.json", indexed);
  json("index/BASELINE_CROSSWALK.json", [
    {
      preserve_app_id: "preserved",
      match_count: 1,
      research_record_ids: ["baseline"],
      original_record_present: true,
    },
  ]);
  json("baseline/repository-catalog-136.json", [
    { id: "preserved", country: "United States" },
    { id: "international", country: "Romania" },
  ]);
  json(
    "index/PHOTO_INDEX.json",
    indexed.map((row) => ({ research_id: row.research_id })),
  );
  json("index/INCLUDED_IMAGE_FILES.json", [
    { path: "images/site.jpg", sha256: sha256(image), bytes: image.length },
  ]);
  files["images/site.jpg"] = image;
  files["index/STATE_COUNTS.csv"] =
    'state,profiles,notes\nState A,1,"Comma, and \"\"quotes\"\""\nState B,1,\n';
  json("records.json", { "a/b": { "~profiles": records } });
  const flush = () => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    writeFileSync(
      join(root, "CHECKSUMS.sha256"),
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, content]) => `${sha256(content)}  ${path}\n`)
        .join(""),
    );
  };
  flush();
  return { root, files, json, flush };
}

test("verifies immutable hashes, escaped pointers, crosswalks and counts without writes", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, "CHECKSUMS.sha256"));
  const result = verifyNationwidePackage(f.root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.completeBundle, true);
  assert.equal(result.profiles, 2);
  assert.equal(result.baselineIdentities, 1);
  assert.equal(result.inputHash, sha256(before));
  assert.deepEqual(readFileSync(join(f.root, "CHECKSUMS.sha256")), before);
});

test("explicit photo omission does not claim full verification and keeps input identity stable", (t) => {
  const f = fixture(t);
  const complete = verifyNationwidePackage(f.root);
  rmSync(join(f.root, "images/site.jpg"));
  assert.equal(verifyNationwidePackage(f.root).ok, false);
  const partial = verifyNationwidePackage(f.root, {
    allowMissingImages: ["images/site.jpg"],
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.completeBundle, false);
  assert.equal(partial.inputHash, complete.inputHash);
  assert.deepEqual(partial.missingImages, ["images/site.jpg"]);
  assert.equal(verifyNationwidePackage(f.root, { dataOnly: true }).ok, true);
  f.flush();
  assert.match(
    verifyNationwidePackage(f.root, {
      allowMissingImages: ["images/site.jpg"],
    }).errors.join(" "),
    /Expected missing image is present/,
  );
});

test("allowed image omission cannot suppress unrelated missing data or corrupted present photos", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, "records.json"));
  const absent = verifyNationwidePackage(f.root, {
    allowMissingImages: ["records.json"],
  });
  assert.equal(absent.ok, false);
  assert.match(
    absent.errors.join(" "),
    /Only indexed images may be allowed missing/,
  );
  f.flush();
  writeFileSync(join(f.root, "images/site.jpg"), "wrong image");
  const corrupt = verifyNationwidePackage(f.root);
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.errors.join(" "), /Hash mismatch: images\/site.jpg/);
});

test("rejects pointer escapes, inherited keys, leading-zero arrays and missing values", () => {
  assert.equal(
    resolveJsonPointer({ "a/b": { "~": "value" } }, "/a~1b/~0"),
    "value",
  );
  for (const pointer of ["/x~2", "/x~", "constructor", "/constructor"])
    assert.throws(() => resolveJsonPointer({}, pointer));
  for (const pointer of ["/01", "/-", "/3", "/-1"])
    assert.throws(() => resolveJsonPointer([1, 2], pointer));
});

test("rejects traversal, symlinks, unmanifested files and duplicate checksum entries", (t) => {
  const f = fixture(t);
  for (const unsafe of ["../outside", "/etc/passwd", "a/../b", "a\\b", "a//b"])
    assert.throws(() => safePackagePath(f.root, unsafe), /Unsafe/);
  symlinkSync(join(f.root, "records.json"), join(f.root, "linked.json"));
  assert.match(
    verifyNationwidePackage(f.root).errors.join(" "),
    /Symlink prohibited/,
  );
  rmSync(join(f.root, "linked.json"));
  writeFileSync(join(f.root, "extra.json"), "{}");
  assert.match(
    verifyNationwidePackage(f.root).errors.join(" "),
    /Unmanifested package file/,
  );
  rmSync(join(f.root, "extra.json"));
  const checksums = readFileSync(join(f.root, "CHECKSUMS.sha256"), "utf8");
  writeFileSync(
    join(f.root, "CHECKSUMS.sha256"),
    checksums + checksums.split("\n")[0] + "\n",
  );
  assert.match(
    verifyNationwidePackage(f.root).errors.join(" "),
    /Repeated checksum path/,
  );
});

test("detects convenience-envelope edits even when the checksum manifest is reissued", (t) => {
  const f = fixture(t);
  const envelopes = JSON.parse(
    f.files["index/ORIGINAL_RECORDS_WITH_INDEX.json"] as string,
  );
  envelopes[1].original_record.story = "Replacement narrative.";
  f.json("index/ORIGINAL_RECORDS_WITH_INDEX.json", envelopes);
  f.flush();
  assert.match(
    verifyNationwidePackage(f.root).errors.join(" "),
    /Original record mismatch: addition/,
  );
});

test("detects crosswalk identity collisions, missing baseline coverage and state-count drift", (t) => {
  const f = fixture(t);
  const crosswalk = JSON.parse(
    f.files["index/GLOBAL_ID_CROSSWALK.json"] as string,
  );
  crosswalk[1].canonical_site_id = crosswalk[0].canonical_site_id;
  f.json("index/GLOBAL_ID_CROSSWALK.json", crosswalk);
  f.json("index/BASELINE_CROSSWALK.json", []);
  f.files["index/STATE_COUNTS.csv"] = "state,profiles\nState A,1\nState B,20\n";
  f.flush();
  const errors = verifyNationwidePackage(f.root).errors.join(" ");
  assert.match(errors, /repeated canonical ID/);
  assert.match(errors, /Baseline profile coverage mismatch/);
  assert.match(errors, /CSV state count mismatch/);
});

test("optional archive verification requires and checks the expected external digest", (t) => {
  const f = fixture(t);
  const archive = join(f.root, "records.json");
  assert.equal(
    verifyNationwidePackage(f.root, {
      archive,
      archiveSha256: sha256(readFileSync(archive)),
    }).ok,
    true,
  );
  assert.match(
    verifyNationwidePackage(f.root, {
      archive,
      archiveSha256: "0".repeat(64),
    }).errors.join(" "),
    /Archive SHA-256 mismatch/,
  );
  assert.match(
    verifyNationwidePackage(f.root, { archive }).errors.join(" "),
    /requires both/,
  );
});
