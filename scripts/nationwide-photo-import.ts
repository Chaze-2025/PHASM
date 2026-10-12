import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  linkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  buildPhotoPatchPlan,
  MEDIA_IMPORTER_VERSION,
} from "./nationwide-media";
import type {
  MediaPlan,
  PhotoPatchManifest,
  PhotoCrosswalk,
} from "./nationwide-media";
import {
  applyRun,
  checkRun,
  canonical,
  catalog,
  makeOperation,
  openImportStore,
  rollbackRun,
  runId,
  verifyProjection,
} from "./nationwide-store";
import type { ImportRun } from "./nationwide-store";
import { readWorkspace, outsideInput } from "./nationwide-import";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const hash = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const save = (file: string, data: unknown) =>
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
interface FrozenPhotoRun {
  run: ImportRun;
  plan: MediaPlan;
  assetRoot: string;
  manifest: PhotoPatchManifest;
  crosswalk: PhotoCrosswalk[];
}
function args() {
  const argv = process.argv.slice(2);
  const command =
    argv[0] && !argv[0].startsWith("--") ? argv.shift()! : "dry-run";
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (
      !argv[i].startsWith("--") ||
      ![
        "workspace",
        "manifest",
        "asset-root",
        "crosswalk",
        "report",
        "batch-size",
        "max-batches",
        "patch-version",
      ].includes(key) ||
      options[key] ||
      !argv[i + 1] ||
      argv[i + 1].startsWith("--")
    )
      throw new Error(`Invalid argument: ${argv[i]}`);
    options[key] = argv[i + 1];
  }
  return { command, options };
}
export async function photoMain() {
  const { command, options: o } = args();
  const required = (key: string) => {
    if (!o[key]) throw new Error(`--${key} is required`);
    return resolve(o[key]);
  };
  const workspace = required("workspace");
  readWorkspace(workspace);
  const planPath = (version: string) => {
    if (
      !/^[a-zA-Z0-9._-]{1,100}$/.test(version) ||
      version === "." ||
      version === ".."
    )
      throw new Error("A safe --patch-version is required");
    return join(workspace, "photo-runs", `${version}.json`);
  };
  if (["dry-run", "plan"].includes(command)) {
    const db = new DatabaseSync(join(workspace, "catalog.sqlite"), {
      readOnly: true,
    });
    try {
      const manifest: PhotoPatchManifest = json(required("manifest"));
      const planFile = planPath(manifest.patchVersion);
      if (o["patch-version"] && o["patch-version"] !== manifest.patchVersion)
        throw new Error("Patch version differs from manifest");
      const crosswalk: PhotoCrosswalk[] = json(required("crosswalk"));
      const assetRoot = required("asset-root");
      outsideInput(assetRoot, workspace);
      if (o.report) outsideInput(assetRoot, required("report"));
      const plan = await buildPhotoPatchPlan(
        catalog(db),
        manifest,
        assetRoot,
        crosswalk,
      );
      const run: ImportRun = {
        importerVersion: MEDIA_IMPORTER_VERSION,
        inputHash: plan.manifestHash,
        kind: "photos",
        operations: plan.records
          .filter((r) => r.nextLocation)
          .map((r) => makeOperation(db, r.nextLocation!)),
      };
      const frozen: FrozenPhotoRun = {
        run,
        plan,
        assetRoot,
        manifest,
        crosswalk,
      };
      if (command === "plan") {
        if (existsSync(planFile)) {
          const previous: FrozenPhotoRun = json(planFile);
          if (
            canonical(previous.manifest) !== canonical(manifest) ||
            canonical(previous.crosswalk) !== canonical(crosswalk) ||
            previous.run.importerVersion !== MEDIA_IMPORTER_VERSION ||
            previous.assetRoot !== assetRoot
          )
            throw new Error(
              "Patch version is already frozen with different inputs; use a new version",
            );
          return {
            patchVersion: manifest.patchVersion,
            ...previous.plan.summary,
            runId: runId(previous.run),
            frozenPlanReused: true,
            databaseWrites: false,
          };
        }
        mkdirSync(join(workspace, "photo-runs"), {
          recursive: true,
          mode: 0o700,
        });
        save(planFile, frozen);
      }
      if (o.report) save(required("report"), plan);
      return {
        patchVersion: plan.patchVersion,
        ...plan.summary,
        runId: runId(run),
        databaseWrites: false,
      };
    } finally {
      db.close();
    }
  }
  if (!["apply", "resume", "rollback"].includes(command))
    throw new Error(`Unknown photo command: ${command}`);
  const frozen: FrozenPhotoRun = json(planPath(o["patch-version"] ?? ""));
  if (frozen.run.importerVersion !== MEDIA_IMPORTER_VERSION)
    throw new Error("Photo importer version differs from frozen plan");
  const db = openImportStore(
    join(workspace, "catalog.sqlite"),
    join(workspace, "journal.sqlite"),
  );
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS import_log.assets (run_id TEXT NOT NULL,destination TEXT NOT NULL,sha256 TEXT NOT NULL,existed INTEGER NOT NULL,PRIMARY KEY(run_id,destination))",
    );
    const id = runId(frozen.run);
    const assets = join(workspace, "assets");
    const target = (destination: string) => {
      if (
        !/^images\/research\/[a-f0-9]{64}\.(jpg|png|webp|avif)$/.test(
          destination,
        )
      )
        throw new Error("Invalid content-addressed asset path");
      return join(assets, destination);
    };
    if (command === "rollback") {
      const receipts = db
        .prepare("SELECT * FROM import_log.assets WHERE run_id = ?")
        .all(id);
      // Check file guards BEFORE rolling back any data. Referenced bytes stay put.
      for (const receipt of receipts) {
        const file = target(String(receipt.destination));
        if (
          !receipt.existed &&
          existsSync(file) &&
          hash(file) !== receipt.sha256
        )
          throw new Error(
            "Photo asset changed since installation; rollback refused",
          );
      }
      const result = rollbackRun(db, id);
      const references = new Set(catalog(db).map((location) => location.image));
      for (const receipt of receipts)
        if (!receipt.existed && !references.has(`/${receipt.destination}`))
          rmSync(target(String(receipt.destination)), { force: true });
      verifyProjection(db);
      save(join(workspace, "photo-rollback.json"), result);
      return result;
    }
    checkRun(db, frozen.run, {
      batchSize: o["batch-size"] ? Number(o["batch-size"]) : 100,
      maxBatches: o["max-batches"] ? Number(o["max-batches"]) : undefined,
    });
    // Re-run exact-file validation against frozen before-images. This also
    // verifies the manifest and every image even when resuming a partial apply.
    const before = frozen.run.operations.map((op) => op.before!);
    const checked = await buildPhotoPatchPlan(
      before,
      frozen.manifest,
      frozen.assetRoot,
      frozen.crosswalk,
    );
    for (const record of frozen.plan.records.filter(
      (r) => r.disposition === "updated",
    )) {
      const candidate = checked.records.find(
        (r) => r.researchId === record.researchId,
      );
      if (!candidate || canonical(candidate) !== canonical(record))
        throw new Error(`Photo verification changed: ${record.researchId}`);
    }
    for (const copy of frozen.plan.assetCopies) {
      const file = target(copy.destination);
      if (hash(copy.source) !== copy.sha256)
        throw new Error("Source asset changed after planning");
      const existing = db
        .prepare(
          "SELECT * FROM import_log.assets WHERE run_id = ? AND destination = ?",
        )
        .get(id, copy.destination);
      if (existsSync(file) && hash(file) !== copy.sha256)
        throw new Error("Asset destination conflict");
      // An intent is durable before copying. Recovery may complete an interrupted
      // immutable copy. Only this workspace's unreferenced new assets are removed.
      if (!existing)
        db.prepare("INSERT INTO import_log.assets VALUES (?,?,?,?)").run(
          id,
          copy.destination,
          copy.sha256,
          Number(existsSync(file)),
        );
      mkdirSync(join(assets, "images/research"), {
        recursive: true,
        mode: 0o700,
      });
      if (!existsSync(file)) {
        const temporary = `${file}.${randomUUID()}.partial`;
        try {
          copyFileSync(copy.source, temporary, constants.COPYFILE_EXCL);
          if (hash(temporary) !== copy.sha256)
            throw new Error("Staged asset hash mismatch");
          try {
            linkSync(temporary, file);
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code !== "EEXIST" ||
              hash(file) !== copy.sha256
            )
              throw error;
          }
        } finally {
          rmSync(temporary, { force: true });
        }
      }
    }
    const result = applyRun(db, frozen.run, {
      batchSize: o["batch-size"] ? Number(o["batch-size"]) : 100,
      maxBatches: o["max-batches"] ? Number(o["max-batches"]) : undefined,
    });
    verifyProjection(db);
    save(join(workspace, "photo-progress.json"), result);
    return result;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  photoMain()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
