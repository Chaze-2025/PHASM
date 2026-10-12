/** Explicit, resumable transport for the separately owner-approved live publication. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPublicationPlan } from "./nationwide-publish";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = "deploy/midnight-preview/wrangler.json";
const database = "phasm-editorial-preview-db";
const databaseId = "fe55176f-43e7-4b79-82c2-02884e4161a0";
const transportVersion = "phasm-live-publication-1";
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
function save(file: string, value: unknown) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(temporary, file);
}
function checkConfig() {
  execFileSync(
    process.execPath,
    ["deploy/midnight-preview/validate-config.mjs"],
    { cwd: root, stdio: "pipe" },
  );
  const value = read(join(root, config));
  if (value.d1_databases[0].database_id !== databaseId)
    throw new Error("Wrong live database");
}
interface FileEntry {
  index: number;
  ids: string[];
  applyFile: string;
  rollbackFile: string;
  applySha256: string;
  rollbackSha256: string;
}
interface Manifest {
  transportVersion: string;
  plannerVersion: string;
  revision: string;
  auditAction: string;
  inputHash: string;
  beforeHash: string;
  afterHash: string;
  databaseId: string;
  created: number;
  updated: number;
  unchanged: number;
  preflightFile: string;
  preflightSha256: string;
  batches: FileEntry[];
}
function verifyFiles(directory: string, manifest: Manifest) {
  if (
    manifest.transportVersion !== transportVersion ||
    manifest.databaseId !== databaseId
  )
    throw new Error("Publication version or target mismatch");
  const files = [
    [manifest.preflightFile, manifest.preflightSha256],
    ...manifest.batches.flatMap((batch) => [
      [batch.applyFile, batch.applySha256],
      [batch.rollbackFile, batch.rollbackSha256],
    ]),
  ];
  for (const [name, expected] of files) {
    if (!/^(?:preflight|apply-\d+|rollback-\d+)\.sql$/.test(name))
      throw new Error("Unsafe publication SQL path");
    if (hash(readFileSync(join(directory, name))) !== expected)
      throw new Error(`Frozen SQL changed: ${name}`);
  }
}
function execute(file: string, log: string) {
  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      [
        join(root, "node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "execute",
        database,
        "--remote",
        "--config",
        config,
        "--file",
        file,
        "--yes",
        "--json",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    writeFileSync(log, `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, {
      mode: 0o600,
    });
    throw new Error(
      `D1 command failed; prior completed batches are checkpointed. Inspect ${log}`,
    );
  }
  writeFileSync(log, stdout, { mode: 0o600 });
  const result = JSON.parse(stdout);
  const values = Array.isArray(result) ? result : [result];
  if (values.some((value) => value.success === false))
    throw new Error(`D1 reported failure; inspect ${log}`);
  return values.reduce(
    (sum, value) => sum + Number(value.meta?.rows_written ?? 0),
    0,
  );
}
export function publicationMain(args = process.argv.slice(2)) {
  const argv = [...args];
  const command =
    argv[0] && !argv[0].startsWith("--") ? argv.shift()! : "check";
  const options: Record<string, string> = {};
  while (argv.length) {
    const flag = argv.shift()!;
    if (
      ![
        "--snapshot-dir",
        "--catalog",
        "--output",
        "--input-hash",
        "--plan-dir",
        "--max-batches",
        "--remote",
      ].includes(flag) ||
      options[flag] !== undefined
    )
      throw new Error(`Invalid option: ${flag}`);
    if (flag === "--remote") options[flag] = "true";
    else {
      const value = argv.shift();
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value: ${flag}`);
      options[flag] = value;
    }
  }
  const required = (flag: string) => {
    const value = options[flag];
    if (!value) throw new Error(`${flag} is required`);
    return resolve(value);
  };
  if (command === "plan") {
    const snapshot = required("--snapshot-dir"),
      directory = required("--output");
    if (existsSync(directory))
      throw new Error(
        "Publication output already exists; reuse its frozen plan or choose a new directory",
      );
    const inputHash = options["--input-hash"];
    if (!inputHash || !/^[a-f0-9]{64}$/.test(inputHash))
      throw new Error(
        "--input-hash requires the verified research fingerprint",
      );
    const plan = buildPublicationPlan(
      {
        locations: read(join(snapshot, "locations.json")),
        sources: read(join(snapshot, "location_sources.json")),
        phenomena: read(join(snapshot, "location_phenomena.json")),
      },
      read(required("--catalog")),
      { inputHash },
    );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const batches = plan.batches.map((batch) => {
      const label = String(batch.index).padStart(4, "0");
      const applyFile = `apply-${label}.sql`,
        rollbackFile = `rollback-${label}.sql`;
      writeFileSync(join(directory, applyFile), batch.applySql, {
        mode: 0o600,
      });
      writeFileSync(join(directory, rollbackFile), batch.rollbackSql, {
        mode: 0o600,
      });
      return {
        index: batch.index,
        ids: batch.ids,
        applyFile,
        rollbackFile,
        applySha256: batch.applySha256,
        rollbackSha256: batch.rollbackSha256,
      };
    });
    writeFileSync(join(directory, "preflight.sql"), plan.preflightSql, {
      mode: 0o600,
    });
    const manifest: Manifest = {
      transportVersion,
      plannerVersion: plan.version,
      revision: plan.revision,
      auditAction: plan.auditAction,
      inputHash,
      beforeHash: plan.beforeHash,
      afterHash: plan.afterHash,
      databaseId,
      created: plan.created,
      updated: plan.updated,
      unchanged: plan.unchanged,
      preflightFile: "preflight.sql",
      preflightSha256: hash(plan.preflightSql),
      batches,
    };
    save(join(directory, "manifest.json"), manifest);
    return {
      revision: plan.revision,
      created: plan.created,
      updated: plan.updated,
      unchanged: plan.unchanged,
      batches: batches.length,
      output: directory,
      remoteWrites: false,
    };
  }
  if (!["check", "apply", "resume", "rollback"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  const directory = required("--plan-dir"),
    manifest: Manifest = read(join(directory, "manifest.json"));
  verifyFiles(directory, manifest);
  checkConfig();
  const manifestHash = hash(readFileSync(join(directory, "manifest.json")));
  if (command === "check")
    return {
      revision: manifest.revision,
      created: manifest.created,
      updated: manifest.updated,
      batches: manifest.batches.length,
      manifestHash,
      target: databaseId,
      remoteWrites: false,
    };
  if (options["--remote"] !== "true")
    throw new Error(
      "Live changes require explicit --remote and the separately approved publication scope",
    );
  const limit = options["--max-batches"]
    ? Number(options["--max-batches"])
    : Infinity;
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1))
    throw new Error("Invalid --max-batches");
  const checkpointFile = join(directory, "checkpoint.json");
  const checkpoint = existsSync(checkpointFile)
    ? read(checkpointFile)
    : {
        manifestHash,
        revision: manifest.revision,
        status: "pending",
        applied: [] as number[],
        rolledBack: [] as number[],
      };
  if (
    checkpoint.manifestHash !== manifestHash ||
    checkpoint.revision !== manifest.revision
  )
    throw new Error("Checkpoint input/plan mismatch");
  if (
    command !== "rollback" &&
    ["rolling-back", "rolled-back"].includes(checkpoint.status)
  )
    throw new Error(
      "A rolled-back publication cannot resume; prepare a new reviewed plan",
    );
  const logdir = join(directory, "logs");
  mkdirSync(logdir, { recursive: true, mode: 0o700 });
  if (command !== "rollback")
    execute(
      join(directory, manifest.preflightFile),
      join(logdir, "preflight.json"),
    );
  else {
    checkpoint.status = "rolling-back";
    save(checkpointFile, checkpoint);
  }
  const order =
    command === "rollback" ? [...manifest.batches].reverse() : manifest.batches;
  let performed = 0;
  for (const batch of order) {
    const done: number[] =
      command === "rollback" ? checkpoint.rolledBack : checkpoint.applied;
    if (done.includes(batch.index)) continue;
    if (performed >= limit) break;
    const filename =
      command === "rollback" ? batch.rollbackFile : batch.applyFile;
    const writes = execute(
      join(directory, filename),
      join(logdir, filename.replace(".sql", ".json")),
    );
    done.push(batch.index);
    performed++;
    save(checkpointFile, checkpoint);
    console.log(
      JSON.stringify({
        phase: command === "rollback" ? "rollback" : "publish",
        batch: batch.index,
        done: done.length,
        total: manifest.batches.length,
        rowsWritten: writes,
      }),
    );
  }
  if (
    command === "rollback" &&
    checkpoint.rolledBack.length === manifest.batches.length
  )
    checkpoint.status = "rolled-back";
  else if (
    command !== "rollback" &&
    checkpoint.applied.length === manifest.batches.length
  )
    checkpoint.status = "complete";
  save(checkpointFile, checkpoint);
  return {
    revision: manifest.revision,
    status: checkpoint.status,
    completed: checkpoint.applied.length,
    rolledBack: checkpoint.rolledBack.length,
    total: manifest.batches.length,
    target: databaseId,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(publicationMain(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
