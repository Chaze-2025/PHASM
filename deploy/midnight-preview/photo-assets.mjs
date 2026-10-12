import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fields = [
  "image",
  "imageAlt",
  "imageCredit",
  "imageLicense",
  "imageSource",
];
const assetPattern = /^images\/research\/([a-f0-9]{64})\.(jpg|png|webp|avif)$/;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const canonical = (value, media = false) => {
  if (Array.isArray(value))
    return `[${value.map((v) => canonical(v, media)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) =>
        media ? a.localeCompare(b) : a < b ? -1 : a > b ? 1 : 0,
      )
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, media)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const hash = (value, media = false) => sha(canonical(value, media));
function check(condition, message) {
  if (!condition) throw new Error(`Photo deployment refused: ${message}`);
}
function regularFile(root, name) {
  const file = join(root, name);
  const rel = relative(realpathSync(root), realpathSync(file));
  check(
    rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    "asset escapes its workspace",
  );
  check(lstatSync(file).isFile(), "only regular asset files are allowed");
  return file;
}
function checkImage(bytes, extension) {
  const format =
    extension === "jpg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === "png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : extension === "webp"
          ? bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP"
          : bytes.subarray(4, 8).toString() === "ftyp" &&
            /avif|avis/.test(bytes.subarray(8, 32).toString());
  check(format, "asset content does not match its reviewed image format");
  check(
    bytes.length <= 25 * 1024 * 1024,
    "asset exceeds the 25 MiB Workers asset limit",
  );
}

/** Read-only verification. No source paths or raw research enter the deployment. */
export function verifyPhotoWorkspace(workspacePath, requestedVersion) {
  const workspace = realpathSync(workspacePath);
  const plan = readJson(regularFile(workspace, "photo-plan.json"));
  const version = requestedVersion ?? plan.patchVersion;
  check(
    typeof version === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(version),
    "invalid patch version",
  );
  const frozenFile = regularFile(workspace, `photo-runs/${version}.json`);
  const frozenBytes = readFileSync(frozenFile);
  const frozen = JSON.parse(frozenBytes.toString("utf8"));
  check(
    canonical(frozen.plan) === canonical(plan),
    "photo-plan differs from the frozen patch",
  );
  check(
    plan.patchVersion === version && frozen.manifest.patchVersion === version,
    "patch version mismatch",
  );
  check(
    plan.importerVersion === "phasm-media-v1" &&
      frozen.run.importerVersion === plan.importerVersion &&
      frozen.run.kind === "photos",
    "unsupported photo importer",
  );
  check(
    plan.manifestHash === hash(frozen.manifest, true) &&
      frozen.run.inputHash === plan.manifestHash,
    "manifest hash mismatch",
  );
  const { planHash, ...body } = plan;
  check(
    planHash ===
      hash(
        {
          ...body,
          assetCopies: plan.assetCopies.map(
            ({ source: _source, ...item }) => item,
          ),
        },
        true,
      ),
    "photo plan hash mismatch",
  );
  const id = hash({ storeVersion: "phasm-local-import-1", ...frozen.run });
  const journal = new DatabaseSync(regularFile(workspace, "journal.sqlite"), {
    readOnly: true,
  });
  const catalog = new DatabaseSync(regularFile(workspace, "catalog.sqlite"), {
    readOnly: true,
  });
  try {
    const receipt = journal.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    check(
      receipt?.status === "complete" &&
        receipt.kind === "photos" &&
        receipt.store_version === "phasm-local-import-1" &&
        receipt.importer_version === plan.importerVersion &&
        receipt.input_hash === plan.manifestHash &&
        receipt.plan_json === canonical(frozen.run),
      "completed run receipt is absent or differs",
    );
    const applied = journal
      .prepare(
        "SELECT position, location_id, applied FROM operations WHERE run_id = ? ORDER BY position",
      )
      .all(id);
    check(
      applied.length === frozen.run.operations.length &&
        applied.every(
          (op, i) =>
            op.applied === 1 &&
            op.position === i &&
            op.location_id === frozen.run.operations[i].id,
        ),
      "photo patch is incomplete",
    );
    const assets = [];
    const seen = new Set();
    for (const copy of plan.assetCopies) {
      const match = assetPattern.exec(copy.destination);
      check(
        match && match[1] === copy.sha256 && !seen.has(copy.destination),
        "invalid or duplicate content-addressed asset path",
      );
      seen.add(copy.destination);
      const record = plan.records.find(
        (row) => row.researchId === copy.researchId,
      );
      const review = record?.review;
      check(
        record?.disposition === "updated" &&
          record.patch &&
          review?.exactFileVerified === true &&
          review.visualSubjectVerified === true &&
          review.rightsVerified === true &&
          review.sha256 === copy.sha256,
        "asset does not have a completed exact-file, rights and visual review",
      );
      check(
        canonical(review) ===
          canonical(
            frozen.manifest.reviews.find(
              (row) => row.researchId === copy.researchId,
            ),
          ),
        "review differs from the frozen manifest",
      );
      const operation = frozen.run.operations.find(
        (op) => op.id === record.appId,
      );
      check(
        operation &&
          record.patch.fields.image === `/${copy.destination}` &&
          fields.every(
            (key) => operation.after[key] === record.patch.fields[key],
          ),
        "photo operation does not reference the reviewed asset",
      );
      const installed = catalog
        .prepare("SELECT data_json FROM locations WHERE id = ?")
        .get(record.appId);
      check(
        installed &&
          fields.every(
            (key) =>
              JSON.parse(installed.data_json)[key] === operation.after[key],
          ),
        "catalog photo fields changed after the reviewed patch",
      );
      const assetReceipt = journal
        .prepare(
          "SELECT sha256 FROM assets WHERE run_id = ? AND destination = ?",
        )
        .get(id, copy.destination);
      check(
        assetReceipt?.sha256 === copy.sha256,
        "installed asset receipt is absent or differs",
      );
      const file = regularFile(join(workspace, "assets"), copy.destination);
      const bytes = readFileSync(file);
      check(sha(bytes) === copy.sha256, "installed image bytes changed");
      checkImage(bytes, match[2]);
      assets.push({
        file,
        destination: copy.destination,
        sha256: copy.sha256,
        bytes: bytes.length,
        appId: record.appId,
        researchId: copy.researchId,
        sourcePage: review.sourcePage,
        originalAssetUrl: review.originalAssetUrl,
        originalAssetSha256: review.originalAssetSha256,
        sourceEvidenceSha256: review.sourceEvidenceSha256,
        creator: review.creator,
        license: review.license,
        licenseUrl: review.licenseUrl,
        attribution: review.attribution,
        reviewedAt: review.reviewedAt,
        subjectDescription: review.subjectDescription,
        transformations: review.transformations,
        shareAlike: review.shareAlike,
      });
    }
    for (const row of catalog
      .prepare("SELECT data_json FROM locations")
      .all()) {
      const image = JSON.parse(row.data_json).image;
      check(
        !image.startsWith("/images/research/") || seen.has(image.slice(1)),
        "catalog references an asset outside the completed patch",
      );
    }
    check(
      assets.length === frozen.run.operations.length,
      "operation and reviewed asset counts differ",
    );
    return {
      patchVersion: version,
      importerVersion: plan.importerVersion,
      manifestHash: plan.manifestHash,
      planHash,
      runId: id,
      frozenRunSha256: sha(frozenBytes),
      count: assets.length,
      totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
      assets,
    };
  } finally {
    journal.close();
    catalog.close();
  }
}

export function installPhotoAssets(verified, destinationRoot) {
  for (const asset of verified.assets) {
    const destination = join(destinationRoot, asset.destination);
    check(
      !existsSync(destination) ||
        sha(readFileSync(destination)) === asset.sha256,
      "existing public image conflicts with reviewed bytes",
    );
    check(
      sha(readFileSync(asset.file)) === asset.sha256,
      "image changed after preflight",
    );
    mkdirSync(dirname(destination), { recursive: true });
    if (!existsSync(destination)) copyFileSync(asset.file, destination);
    check(
      sha(readFileSync(destination)) === asset.sha256,
      "copied image hash mismatch",
    );
  }
  return {
    ...verified,
    assets: verified.assets.map(({ file: _file, ...metadata }) => metadata),
  };
}

export function validateAssetLimits(directory) {
  let count = 0;
  let bytes = 0;
  const walk = (root) => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        check(entry.isFile(), "generated asset is not a regular file");
        const size = lstatSync(file).size;
        check(size <= 25 * 1024 * 1024, "generated asset exceeds 25 MiB");
        bytes += size;
        count++;
      }
    }
  };
  walk(directory);
  check(
    count <= 20_000,
    "generated assets exceed the Workers Free 20,000-file limit",
  );
  return {
    files: count,
    bytes,
    maximumFiles: 20_000,
    maximumFileBytes: 25 * 1024 * 1024,
  };
}
