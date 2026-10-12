import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonical, digest } from "../scripts/nationwide-store";
import { mediaHash } from "../scripts/nationwide-media";
import {
  verifyPhotoWorkspace,
  installPhotoAssets,
  validateAssetLimits,
} from "../deploy/midnight-preview/photo-assets.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "phasm-deploy-test-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mcAAAAASUVORK5CYII=",
    "base64",
  );
  const sha256 = createHash("sha256").update(png).digest("hex");
  const destination = `images/research/${sha256}.png`;
  mkdirSync(join(root, "assets/images/research"), { recursive: true });
  mkdirSync(join(root, "photo-runs"));
  const file = join(root, "assets", destination);
  writeFileSync(file, png);
  const review = {
    researchId: "sample",
    sha256,
    exactFileVerified: true,
    visualSubjectVerified: true,
    rightsVerified: true,
    creator: "Test Author",
    license: "CC BY 4.0",
    sourcePage: "https://example.com/photo",
    originalAssetUrl: "https://example.com/photo.png",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Test Author / CC BY 4.0",
    reviewedAt: "2026-10-12",
  };
  const fields = {
    image: `/${destination}`,
    imageAlt: "A sample",
    imageCredit: review.attribution,
    imageLicense: review.license,
    imageSource: review.sourcePage,
  };
  const after = { id: "sample", ...fields };
  const manifest = { patchVersion: "sample-v1", reviews: [review] };
  const manifestHash = mediaHash(manifest);
  const body = {
    importerVersion: "phasm-media-v1",
    patchVersion: manifest.patchVersion,
    manifestHash,
    records: [
      {
        researchId: "sample",
        appId: "sample",
        disposition: "updated",
        review,
        patch: { fields },
      },
    ],
    assetCopies: [
      {
        destination,
        sha256,
        researchId: "sample",
        source: "/private/original.png",
      },
    ],
    summary: { updated: 1 },
  };
  const plan = {
    ...body,
    planHash: mediaHash({
      ...body,
      assetCopies: body.assetCopies.map(({ source: _source, ...item }) => item),
    }),
  };
  const run = {
    importerVersion: "phasm-media-v1",
    inputHash: manifestHash,
    kind: "photos",
    operations: [{ id: "sample", after }],
  };
  const id = digest({ storeVersion: "phasm-local-import-1", ...run });
  writeFileSync(join(root, "photo-plan.json"), JSON.stringify(plan));
  writeFileSync(
    join(root, "photo-runs/sample-v1.json"),
    JSON.stringify({ plan, run, manifest }),
  );
  const journal = new DatabaseSync(join(root, "journal.sqlite"));
  journal.exec(
    "CREATE TABLE runs(id TEXT, status TEXT, kind TEXT, store_version TEXT, importer_version TEXT, input_hash TEXT, plan_json TEXT); CREATE TABLE operations(run_id TEXT, position INTEGER, location_id TEXT, applied INTEGER); CREATE TABLE assets(run_id TEXT, destination TEXT, sha256 TEXT)",
  );
  journal
    .prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?)")
    .run(
      id,
      "complete",
      "photos",
      "phasm-local-import-1",
      "phasm-media-v1",
      manifestHash,
      canonical(run),
    );
  journal
    .prepare("INSERT INTO operations VALUES(?,?,?,?)")
    .run(id, 0, "sample", 1);
  journal
    .prepare("INSERT INTO assets VALUES(?,?,?)")
    .run(id, destination, sha256);
  journal.close();
  const catalog = new DatabaseSync(join(root, "catalog.sqlite"));
  catalog.exec("CREATE TABLE locations(id TEXT, data_json TEXT)");
  catalog
    .prepare("INSERT INTO locations VALUES(?,?)")
    .run("sample", JSON.stringify(after));
  catalog.close();
  return {
    root,
    file,
    png,
    destination,
    id,
    plan,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("deployment copies only receipted image bytes and sanitized provenance, with repeatable installation", () => {
  const f = fixture();
  try {
    const verified = verifyPhotoWorkspace(f.root);
    const assets = join(f.root, "deployed");
    const provenance = installPhotoAssets(verified, assets);
    assert.equal(provenance.count, 1);
    assert.equal(JSON.stringify(provenance).includes(f.root), false);
    assert.equal(
      JSON.stringify(provenance).includes("/private/original.png"),
      false,
    );
    const file = join(assets, f.destination);
    const modified = statSync(file).mtimeMs;
    installPhotoAssets(verified, assets);
    assert.equal(statSync(file).mtimeMs, modified);
    assert.deepEqual(readFileSync(file), f.png);
    assert.equal(validateAssetLimits(assets).files, 1);
  } finally {
    f.cleanup();
  }
});

test("deployment rejects changed image bytes and incomplete or missing receipts", () => {
  for (const failure of ["bytes", "run", "operation", "asset"]) {
    const f = fixture();
    try {
      if (failure === "bytes") writeFileSync(f.file, "different image");
      else {
        const db = new DatabaseSync(join(f.root, "journal.sqlite"));
        if (failure === "run") db.exec("UPDATE runs SET status='pending'");
        if (failure === "operation") db.exec("UPDATE operations SET applied=0");
        if (failure === "asset") db.exec("DELETE FROM assets");
        db.close();
      }
      assert.throws(
        () => verifyPhotoWorkspace(f.root),
        /Photo deployment refused/,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("deployment refuses catalog edits, substituted plans and asset symlinks", () => {
  for (const failure of ["catalog", "plan", "symlink"]) {
    const f = fixture();
    try {
      if (failure === "catalog") {
        const db = new DatabaseSync(join(f.root, "catalog.sqlite"));
        db.exec(
          "UPDATE locations SET data_json=json_set(data_json,'$.imageCredit','Other author')",
        );
        db.close();
      } else if (failure === "plan") {
        const plan = JSON.parse(
          readFileSync(join(f.root, "photo-plan.json"), "utf8"),
        );
        plan.assetCopies[0].destination = "../../secret.txt";
        writeFileSync(join(f.root, "photo-plan.json"), JSON.stringify(plan));
      } else {
        const target = join(f.root, "other.png");
        writeFileSync(target, f.png);
        rmSync(f.file);
        symlinkSync(target, f.file);
      }
      assert.throws(
        () => verifyPhotoWorkspace(f.root),
        /Photo deployment refused/,
      );
    } finally {
      f.cleanup();
    }
  }
});

test("deployment never overwrites conflicting existing image files", () => {
  const f = fixture();
  try {
    const verified = verifyPhotoWorkspace(f.root);
    const assets = join(f.root, "deployed");
    mkdirSync(join(assets, "images/research"), { recursive: true });
    const destination = join(assets, f.destination);
    writeFileSync(destination, "existing bytes");
    assert.throws(() => installPhotoAssets(verified, assets), /conflicts/);
    assert.equal(readFileSync(destination, "utf8"), "existing bytes");
  } finally {
    f.cleanup();
  }
});
