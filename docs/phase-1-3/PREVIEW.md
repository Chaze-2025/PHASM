# Midnight Séance preview operations

## Isolation

| Item                       | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| Development branch         | `dev/phasm-phase-1-3`                                    |
| Worker                     | `phasm-phase-1-3-preview`                                |
| Intended HTTPS origin      | `https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev` |
| Configuration              | `deploy/midnight-preview/wrangler.json`                  |
| Data                       | Existing `phasm-phase-1-preview-db`, 10 location records |
| Preserved Phase 1 commit   | `9da89485891f07d584a426d487f707af6ef06f46`               |
| Preserved Phase 1.1 commit | `cf915ba2c39856346ceb087e374f2f371cc327ca`               |

The origin above is a target until deployment has been verified. The separate worker uses the existing preview database; it does not use a production database. No remote migrations, imports, or content writes are needed for this visual phase. The original `wrangler.jsonc` and `deploy/preview/` configuration remain unchanged. No custom domain, production route, or merge into `main` is part of this deployment.

## Prepare and deploy

Run from the repository root on the expected development branch:

```sh
node deploy/midnight-preview/validate-config.mjs
node deploy/midnight-preview/prepare.mjs
npx wrangler deploy --config deploy/midnight-preview/wrangler.json --dry-run
npx wrangler deploy --config deploy/midnight-preview/wrangler.json
```

Preparation requires a clean working tree containing both preserved ancestor commits, rebuilds the application, and records its source branch and commit in the ignored `.generated/source.json`. `--allow-dirty` is available for local dry-run checks only; rerun without it before deploying. See [the deployment guide](../../deploy/midnight-preview/README.md) for the full workflow.

## Authentication and free-tier limits

The existing Wrangler OAuth authorization was checked successfully on 2026-10-08 and identifies the configured account. It provides account-read, Workers-script-write, and D1 permissions. Wrangler warns about broader optional scopes, but this preview does not require additional products or permissions. The owner previously confirmed **Workers Free**. No purchase, upgrade, additional paid binding, or observability service is enabled. Account-wide free usage limits and the external map provider's limits still apply.

If authentication expires, authorize Wrangler using its supported login flow for the existing account; do not paste tokens into source files or client-side variables.

## Read-only evaluation controls

The wrapper rejects administrative and development paths, disallows non-GET/HEAD requests, explicitly denies community submissions, omits administrative credentials, and forwards only `DB`, `ASSETS`, and public `SITE_URL` bindings. All preview responses receive indexing restrictions, and `robots.txt` disallows crawling. The preview remains publicly reachable for evaluation: indexing restrictions are not authentication.

Verify the deployed homepage, atlas, profile, search, filters, images, touch-sized controls, keyboard access, reduced motion, and mobile overflow. Check denial of admin/development endpoints and community writes. Physical iPhone/Safari testing must be identified separately from Chromium mobile emulation.

## Deployment record

The final deployment command prints the live HTTPS URL and Cloudflare version ID. The handoff records these results together with the deployed Git commit and live verification results. The ignored `deploy/midnight-preview/.generated/source.json` records the exact source provenance for each preparation; it is operational metadata rather than a public application endpoint.
