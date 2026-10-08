import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateConfig() {
  const config = JSON.parse(
    readFileSync(new URL("./wrangler.json", import.meta.url), "utf8"),
  );
  const fail = (message) => {
    throw new Error(message);
  };
  const allowed = [
    "$schema",
    "name",
    "account_id",
    "main",
    "compatibility_date",
    "workers_dev",
    "preview_urls",
    "routes",
    "assets",
    "d1_databases",
    "vars",
    "observability",
  ];
  if (Object.keys(config).some((key) => !allowed.includes(key)))
    fail("Unexpected preview service or setting.");
  if (config.name !== "phasm-phase-1-3-preview")
    fail("Wrong preview Worker name.");
  if (config.account_id !== "c534ce8f6c2a3b0a54ef39a39b4acced")
    fail("Wrong authorized Cloudflare account.");
  if (config.main !== "worker.mjs") fail("Wrong preview entry point.");
  if (
    config.workers_dev !== true ||
    config.preview_urls !== false ||
    !Array.isArray(config.routes) ||
    config.routes.length
  )
    fail("Only the isolated workers.dev hostname may be enabled.");
  if (
    JSON.stringify(config.assets) !==
    JSON.stringify({
      directory: ".generated/assets",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: ["/*", "!/assets/*", "!/images/*", "!/favicon.svg"],
    })
  )
    fail("Unexpected preview asset binding or routing.");
  if (
    JSON.stringify(config.d1_databases) !==
    JSON.stringify([
      {
        binding: "DB",
        database_name: "phasm-phase-1-preview-db",
        database_id: "30400e9a-8eb0-4605-a3a4-0db6470301d1",
        migrations_dir: "../../migrations",
      },
    ])
  )
    fail("Only the existing separate preview database may be used.");
  if (
    JSON.stringify(config.vars) !==
    JSON.stringify({
      SITE_URL: "https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev",
    })
  )
    fail(
      "No credentials or other variables are allowed in preview configuration.",
    );
  if (
    JSON.stringify(config.observability) !== JSON.stringify({ enabled: false })
  )
    fail("Preview observability must remain disabled.");
  return config;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  validateConfig();
  console.log(
    "Validated: isolated Phase 1.3 Worker; existing preview D1; no extra services or secrets.",
  );
}
