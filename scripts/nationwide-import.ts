import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  resolve,
  join,
  relative,
  isAbsolute,
  dirname,
  basename,
} from "node:path";
import { pathToFileURL } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import {
  buildNationwidePlan,
  NATIONWIDE_ADAPTER_VERSION,
} from "./nationwide-adapters";
import type { NationwidePlan } from "./nationwide-adapters";
import {
  applyRun,
  canonical,
  catalog,
  digest,
  makeOperation,
  openImportStore,
  rollbackRun,
  runId,
  runProgress,
  STORE_VERSION,
  verifyProjection,
} from "./nationwide-store";
import type { ImportRun } from "./nationwide-store";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const fileHash = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
function save(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
export function outsideInput(input: string, destination: string) {
  let existing = destination;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    tail.unshift(basename(existing));
    existing = dirname(existing);
  }
  const actual = resolve(realpathSync(existing), ...tail);
  const rel = relative(realpathSync(input), actual);
  if (!rel || (!rel.startsWith("../") && rel !== ".." && !isAbsolute(rel)))
    throw new Error("Reports/workspace must stay outside immutable input");
}
interface Workspace {
  version: string;
  snapshotHash: string;
  source: string;
}
export function readWorkspace(path: string): Workspace {
  const meta: Workspace = json(join(path, "workspace.json"));
  if (
    meta.version !== STORE_VERSION ||
    fileHash(join(path, "baseline.sqlite")) !== meta.snapshotHash
  )
    throw new Error("Workspace snapshot/version mismatch");
  const catalogPath = realpathSync(join(path, "catalog.sqlite"));
  if (
    catalogPath !== join(realpathSync(path), "catalog.sqlite") ||
    catalogPath ===
      (existsSync(meta.source)
        ? realpathSync(meta.source)
        : resolve(meta.source))
  )
    throw new Error("Refusing to edit the original snapshot");
  if (
    existsSync(join(path, "journal.sqlite")) &&
    realpathSync(join(path, "journal.sqlite")) !==
      join(realpathSync(path), "journal.sqlite")
  )
    throw new Error("Journal must stay inside the isolated workspace");
  return meta;
}
export async function prepareWorkspace(snapshot: string, workspace: string) {
  if (existsSync(workspace))
    throw new Error("Workspace already exists; resume it or choose a new path");
  if (!statSync(snapshot).isFile())
    throw new Error("Snapshot must be a local SQLite file");
  const db = new DatabaseSync(snapshot, { readOnly: true });
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  try {
    verifyProjection(db);
    // SQLite's backup includes committed WAL data and takes a consistent view.
    await backup(db, join(workspace, "baseline.sqlite"));
  } finally {
    db.close();
  }
  copyFileSync(
    join(workspace, "baseline.sqlite"),
    join(workspace, "catalog.sqlite"),
  );
  save(join(workspace, "workspace.json"), {
    version: STORE_VERSION,
    snapshotHash: fileHash(join(workspace, "baseline.sqlite")),
    source: realpathSync(snapshot),
  });
}
function markdownReport(plan: NationwidePlan, selection: string) {
  const counts = Object.entries(plan.summary)
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join("\n");
  const issues = plan.records.filter((r) =>
    ["conflicted", "rejected", "deferred"].includes(r.disposition),
  );
  const warningCounts = new Map<string, number>();
  for (const record of plan.records)
    for (const warning of record.warnings)
      warningCounts.set(
        warning.code,
        (warningCounts.get(warning.code) ?? 0) + 1,
      );
  return `# Nationwide research preview report\n\nSelection: ${selection}. Importer: ${plan.version}. Input fingerprint: ${plan.inputFingerprint}.\n\nNew records remain drafts. No live data is changed by this local workflow.\n\n| Measure | Count |\n| --- | ---: |\n${counts}\n\n## Review warnings\n\n${[
    ...warningCounts,
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `- ${code}: ${count}`)
    .join(
      "\n",
    )}\n\n## Unapplied research records\n\n${issues.length ? issues.map((r) => `- ${r.researchId}: ${r.disposition}; ${r.warnings.map((w) => w.message).join("; ")}`).join("\n") : "None."}\n\nSee records.json for every input disposition, provenance, field decisions, source associations and unabridged original research. crosswalk.json maps stable identities. This report is not publication or photo clearance.\n`;
}
export function writeReports(
  directory: string,
  plan: NationwidePlan,
  selection: string,
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  save(join(directory, "summary.json"), {
    importerVersion: plan.version,
    inputFingerprint: plan.inputFingerprint,
    selection,
    summary: plan.summary,
    pilotIds: plan.pilotIds,
  });
  save(join(directory, "records.json"), plan.records);
  save(
    join(directory, "crosswalk.json"),
    plan.records.map((r) => ({
      researchId: r.researchId,
      appId: r.appId,
      baseline: r.baseline,
      disposition: r.disposition,
      sourceFile: r.sourceFile,
      recordPointer: r.recordPointer,
      beforeHash: r.beforeHash,
      afterHash: r.afterHash,
    })),
  );
  save(join(directory, "catalog.json"), plan.locations);
  save(join(directory, "audits.json"), plan.audits);
  save(join(directory, "input-files.json"), plan.inputFiles);
  writeFileSync(join(directory, "REPORT.md"), markdownReport(plan, selection), {
    mode: 0o600,
  });
}
export function contentRun(
  db: DatabaseSync,
  plan: NationwidePlan,
  packageHash: string,
): ImportRun {
  return {
    importerVersion: NATIONWIDE_ADAPTER_VERSION,
    inputHash: digest({ adapterInput: plan.inputFingerprint, packageHash }),
    kind: "content",
    operations: plan.records
      .filter(
        (r) =>
          r.nextLocation &&
          ["created", "updated", "unchanged"].includes(r.disposition),
      )
      .map((r) => makeOperation(db, r.nextLocation!)),
  };
}
function parseArgs(args: string[]) {
  const command =
    args[0] && !args[0].startsWith("--") ? args.shift()! : "dry-run";
  const options: Record<string, string> = {};
  const allowed = new Set([
    "input",
    "snapshot",
    "workspace",
    "selection",
    "report-dir",
    "batch-size",
    "max-batches",
    "run",
    "allow-missing-images",
    "archive",
    "output",
    "manifest",
    "asset-root",
  ]);
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, "");
    if (
      !args[i].startsWith("--") ||
      !allowed.has(name) ||
      options[name] !== undefined
    )
      throw new Error(`Unknown or repeated option: ${args[i]}`);
    if (name === "allow-missing-images") options[name] = "true";
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value: --${name}`);
      options[name] = value;
    }
  }
  return { command, options };
}
export async function main(args = process.argv.slice(2)) {
  const { command, options: o } = parseArgs([...args]);
  const required = (key: string) => {
    if (!o[key]) throw new Error(`--${key} is required`);
    return resolve(o[key]);
  };
  if (command === "prepare") {
    await prepareWorkspace(required("snapshot"), required("workspace"));
    return { prepared: required("workspace"), liveWrites: false };
  }
  if (["dry-run", "validate", "plan", "apply", "resume"].includes(command)) {
    const input = required("input");
    if (o["report-dir"]) outsideInput(input, required("report-dir"));
    if (o.workspace) outsideInput(input, required("workspace"));
    // Input validation is shared with the standalone verification command.
    const { verifyNationwidePackage, safePackagePath } =
      await import("./nationwide-verify");
    const allowedMissing =
      o["allow-missing-images"] === "true"
        ? (
            json(join(input, "index/INCLUDED_IMAGE_FILES.json")) as {
              path: string;
            }[]
          )
            .filter((row) => !existsSync(safePackagePath(input, row.path)))
            .map((row) => row.path)
        : [];
    const verification = verifyNationwidePackage(input, {
      allowMissingImages: allowedMissing,
      archive: o.archive ? resolve(o.archive) : undefined,
      archiveSha256: o.archive
        ? "f7efc43f8c82fb5edb94db6c283e5230590afa492dc96f7c5b16ae5e85f14079"
        : undefined,
    });
    if (!verification.ok)
      throw new Error(
        `Package validation failed: ${JSON.stringify(verification.errors)}`,
      );
    if (["dry-run", "validate", "plan"].includes(command)) {
      const workspace = o.workspace ? required("workspace") : undefined;
      if (workspace) readWorkspace(workspace);
      const db = new DatabaseSync(
        workspace ? join(workspace, "baseline.sqlite") : required("snapshot"),
        { readOnly: true },
      );
      try {
        const full = buildNationwidePlan(input, catalog(db));
        const selection = o.selection ?? "full";
        if (!["full", "pilot"].includes(selection))
          throw new Error("Selection must be full or pilot");
        const plan =
          selection === "pilot"
            ? buildNationwidePlan(input, catalog(db), {
                selectedIds: full.pilotIds,
              })
            : full;
        if (command === "plan") {
          if (!workspace)
            throw new Error(
              "plan requires an isolated --workspace; use dry-run for read-only validation",
            );
          const file = join(workspace, "run.json");
          const run = contentRun(db, plan, verification.inputHash);
          if (existsSync(file) && canonical(json(file)) !== canonical(run))
            throw new Error(
              "A different frozen plan exists; create a new workspace",
            );
          if (!existsSync(file)) save(file, run);
          save(join(workspace, "verification.json"), verification);
          writeReports(join(workspace, "reports"), plan, selection);
          return {
            ...plan.summary,
            runId: runId(run),
            selection,
            report: join(workspace, "reports/REPORT.md"),
            databaseWrites: false,
          };
        }
        if (o["report-dir"]) {
          writeReports(required("report-dir"), plan, selection);
          save(join(required("report-dir"), "verification.json"), verification);
        }
        return {
          ...plan.summary,
          selection,
          inputFingerprint: plan.inputFingerprint,
          verification,
          databaseWrites: false,
        };
      } finally {
        db.close();
      }
    }
    const workspace = required("workspace");
    readWorkspace(workspace);
    const run: ImportRun = json(join(workspace, "run.json"));
    const baseline = new DatabaseSync(join(workspace, "baseline.sqlite"), {
      readOnly: true,
    });
    try {
      const current = buildNationwidePlan(input, catalog(baseline));
      if (
        current.version !== run.importerVersion ||
        digest({
          adapterInput: current.inputFingerprint,
          packageHash: verification.inputHash,
        }) !== run.inputHash
      )
        throw new Error(
          "Input/importer differs from the frozen plan; resume refused",
        );
    } finally {
      baseline.close();
    }
    const db = openImportStore(
      join(workspace, "catalog.sqlite"),
      join(workspace, "journal.sqlite"),
    );
    try {
      const progress = applyRun(db, run, {
        batchSize: o["batch-size"] ? Number(o["batch-size"]) : undefined,
        maxBatches: o["max-batches"] ? Number(o["max-batches"]) : undefined,
      });
      verifyProjection(db);
      save(join(workspace, "progress.json"), progress);
      save(join(workspace, "current-catalog.json"), catalog(db));
      return {
        ...progress,
        catalogCount: catalog(db).length,
        liveWrites: false,
      };
    } finally {
      db.close();
    }
  }
  if (["report", "rollback", "export"].includes(command)) {
    const workspace = required("workspace");
    readWorkspace(workspace);
    if (command === "export") {
      const db = new DatabaseSync(join(workspace, "catalog.sqlite"), {
        readOnly: true,
      });
      try {
        verifyProjection(db);
        const { toSql } = await import("./import-locations");
        // Export is for a NEW, empty isolated local D1 only; it isn't an upsert.
        writeFileSync(required("output"), toSql(catalog(db)), { mode: 0o600 });
        return {
          exported: catalog(db).length,
          output: required("output"),
          databaseWrites: false,
        };
      } finally {
        db.close();
      }
    }
    const id = o.run ?? runId(json(join(workspace, "run.json")));
    const db = openImportStore(
      join(workspace, "catalog.sqlite"),
      join(workspace, "journal.sqlite"),
    );
    try {
      const result =
        command === "rollback" ? rollbackRun(db, id) : runProgress(db, id);
      verifyProjection(db);
      if (command === "rollback")
        save(join(workspace, "rollback.json"), result);
      return { ...result, catalogCount: catalog(db).length, liveWrites: false };
    } finally {
      db.close();
    }
  }
  throw new Error(`Unknown command: ${command}`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
