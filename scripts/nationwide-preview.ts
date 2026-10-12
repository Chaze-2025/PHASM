/** Reproducible loopback-only view of an isolated import workspace. Never deploys. */
import {
  cpSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "phasm-local-preview-1";
const LOCAL_ID = "00000000-0000-0000-0000-000000000000";
const NAME = "phasm-nationwide-local-review";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function treeHash(directory: string): string {
  const files: string[] = [];
  function visit(folder: string) {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) visit(path);
      else
        files.push(`${relative(directory, path)}:${hash(readFileSync(path))}`);
    }
  }
  visit(directory);
  return hash(files.join("\n"));
}
function run(args: string[], env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Local preview command failed (${result.status ?? result.signal}).`,
    );
}
const wrangler = (...args: string[]) =>
  run([join(root, "node_modules/wrangler/bin/wrangler.js"), ...args]);
function wranglerLogged(log: string, ...args: string[]) {
  const descriptor = openSync(log, "w", 0o600);
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, "node_modules/wrangler/bin/wrangler.js"), ...args],
      {
        cwd: root,
        env: process.env,
        stdio: ["ignore", descriptor, descriptor],
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(`Local D1 preparation failed; inspect ${log}.`);
  } finally {
    closeSync(descriptor);
  }
}

export async function previewMain(args = process.argv.slice(2)) {
  const command = args.shift() || "help";
  const options: Record<string, string> = {};
  while (args.length) {
    const flag = args.shift()!;
    if (
      ![
        "--workspace",
        "--preview",
        "--port",
        "--photo-assets",
        "--screenshots",
      ].includes(flag) ||
      !args.length
    )
      throw new Error(`Unknown or incomplete option: ${flag}`);
    options[flag.slice(2)] = args.shift()!;
  }
  const required = (key: string) => {
    if (!options[key]) throw new Error(`--${key} is required`);
    return resolve(options[key]);
  };
  if (command === "help")
    return {
      commands: [
        "setup --workspace DIR --preview NEW_DIR [--port 5181] [--photo-assets DIR]",
        "serve --preview DIR",
        "check-browser --preview DIR [--screenshots DIR]",
      ],
      mode: "Local only. Setup never changes the import workspace or live data; serve binds 127.0.0.1.",
    };
  if (!["setup", "serve", "check-browser"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  const preview = required("preview");
  const manifestPath = join(preview, "preview.json");
  const configPath = join(preview, "wrangler.json");
  if (command === "setup") {
    const workspace = required("workspace");
    if (preview === workspace || preview.startsWith(`${workspace}/`))
      throw new Error(
        "Preview directory must be outside the import workspace.",
      );
    const port = Number(options.port ?? 5181);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Choose a local port from 1024 through 65535.");
    const assets = join(root, "dist/client");
    const worker = join(root, "dist/phasm/index.js");
    if (!existsSync(join(assets, "index.html")))
      throw new Error("Run npm run build before preparing the preview.");
    const db = new DatabaseSync(join(workspace, "catalog.sqlite"), {
      readOnly: true,
    });
    let catalogHash: string;
    let catalogCount: number;
    try {
      const rows = db
        .prepare("SELECT data_json FROM locations ORDER BY id")
        .all();
      catalogHash = hash(JSON.stringify(rows));
      catalogCount = rows.length;
    } finally {
      db.close();
    }
    const photoAssets = options["photo-assets"]
      ? required("photo-assets")
      : null;
    const identity = {
      version: VERSION,
      workspace,
      port,
      catalogHash,
      catalogCount,
      buildHash: treeHash(assets),
      workerHash: hash(readFileSync(worker)),
      photoAssetsHash: photoAssets ? treeHash(photoAssets) : null,
    };
    if (existsSync(preview)) {
      const previous = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : null;
      if (!previous || JSON.stringify(previous) !== JSON.stringify(identity))
        throw new Error(
          "Preview already exists with different or incomplete inputs. Keep it for review and choose a new --preview directory.",
        );
      return {
        ...identity,
        preview,
        unchanged: true,
        url: `http://127.0.0.1:${port}/admin/review`,
        liveWrites: false,
      };
    }
    mkdirSync(preview, { recursive: true, mode: 0o700 });
    cpSync(assets, join(preview, "assets"), { recursive: true });
    cpSync(worker, join(preview, "worker.mjs"));
    if (photoAssets)
      cpSync(photoAssets, join(preview, "assets"), { recursive: true });
    const config = {
      name: NAME,
      main: join(preview, "worker.mjs"),
      compatibility_date: "2026-10-01",
      assets: {
        directory: join(preview, "assets"),
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: ["/*"],
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: NAME,
          database_id: LOCAL_ID,
          migrations_dir: join(root, "migrations"),
        },
      ],
      vars: {
        SITE_URL: `http://127.0.0.1:${port}`,
        EDITORIAL_READ_ONLY: "true",
      },
      observability: { enabled: false },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    writeFileSync(
      join(preview, ".dev.vars"),
      `ADMIN_TOKEN=${randomBytes(32).toString("hex")}\n`,
      { mode: 0o600 },
    );
    const sql = join(preview, "catalog.sql");
    run([
      "--import",
      "tsx",
      "scripts/nationwide-import.ts",
      "export",
      "--workspace",
      workspace,
      "--output",
      sql,
    ]);
    const flags = [
      "--local",
      "--config",
      configPath,
      "--persist-to",
      join(preview, "persist"),
    ];
    wranglerLogged(
      join(preview, "migrations.log"),
      "d1",
      "migrations",
      "apply",
      NAME,
      ...flags,
    );
    wranglerLogged(
      join(preview, "catalog-import.log"),
      "d1",
      "execute",
      NAME,
      ...flags,
      "--file",
      sql,
    );
    writeFileSync(manifestPath, JSON.stringify(identity), { mode: 0o600 });
    return {
      ...identity,
      preview,
      unchanged: false,
      url: `http://127.0.0.1:${port}/admin/review`,
      credentialFile: join(preview, ".dev.vars"),
      liveWrites: false,
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    manifest.version !== VERSION ||
    config.name !== NAME ||
    config.account_id ||
    config.routes ||
    config.d1_databases?.length !== 1 ||
    config.d1_databases[0].database_id !== LOCAL_ID ||
    config.vars?.EDITORIAL_READ_ONLY !== "true" ||
    config.vars?.SITE_URL !== `http://127.0.0.1:${manifest.port}` ||
    config.main !== join(preview, "worker.mjs") ||
    hash(readFileSync(config.main)) !== manifest.workerHash
  )
    throw new Error("Refusing a modified or nonlocal preview configuration.");
  if (command === "serve") {
    wrangler(
      "dev",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      join(preview, "persist"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(manifest.port),
    );
  } else {
    const token = readFileSync(join(preview, ".dev.vars"), "utf8").match(
      /^ADMIN_TOKEN=([a-f0-9]{64})$/m,
    )?.[1];
    if (!token)
      throw new Error(
        "The isolated preview credential is missing or malformed.",
      );
    run(["tests/nationwide-review-browser.mjs"], {
      ...process.env,
      ADMIN_TOKEN: token,
      PHASM_BASE_URL: `http://127.0.0.1:${manifest.port}`,
      PHASM_SCREENSHOT_DIR: options.screenshots
        ? required("screenshots")
        : join(preview, "screenshots"),
    });
  }
  return { preview, command, liveWrites: false };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  previewMain()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
