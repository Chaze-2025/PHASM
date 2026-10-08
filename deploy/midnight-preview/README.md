# PHASM Phase 1.3 Cloudflare preview

This directory deploys the existing application build to a separate evaluation Worker. The Phase 1 and Phase 1.1 Workers, their preview configurations, production configuration, location records, and original commit `9da89485891f07d584a426d487f707af6ef06f46` remain preserved.

| Resource                    | Target                                                   |
| --------------------------- | -------------------------------------------------------- |
| Branch                      | `dev/phasm-phase-1-3`                                    |
| Preview Worker              | `phasm-phase-1-3-preview`                                |
| Preview origin              | `https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev` |
| Existing preview D1         | `phasm-phase-1-preview-db`                               |
| Preserved Phase 1.1 preview | `https://phasm-phase-1-1-preview.wj7djnw2j2.workers.dev` |
| Preserved Phase 1 preview   | `https://phasm-phase-1-preview.wj7djnw2j2.workers.dev`   |

The origin above is the deployment target, not proof of a successful deployment. Verify the actual deployment before sharing it as live.

## Prepare and inspect

Run from the repository root after installing locked dependencies with `npm ci`:

```sh
node deploy/midnight-preview/validate-config.mjs
node deploy/midnight-preview/prepare.mjs
npx wrangler deploy --config deploy/midnight-preview/wrangler.json --dry-run
```

Preparation requires the expected branch, the original Phase 1 and Phase 1.1 commits as ancestors, and a clean working tree. It performs a fresh production build, copies public assets into ignored `.generated/assets`, adds preview-only indexing headers, and records the exact source commit in `.generated/source.json`. The configuration uses relative paths, so the same commands work in another checkout. Vite packages the MapLibre browser worker through the application's asset import.

For local review before committing, `node deploy/midnight-preview/prepare.mjs --allow-dirty` permits a marked, uncommitted build. Use that output only for local checks and Wrangler's `--dry-run`. Before a real deployment, commit reviewed changes and rerun preparation **without** `--allow-dirty`.

## Update the preview

Wrangler must be authenticated to the account already configured here. Use `npx wrangler whoami` to verify the account. If authorization has expired, use Wrangler's supported login flow; never commit authentication tokens or place them in client variables. The account owner confirmed the **Workers Free** plan. Do not upgrade the plan or enable paid services.

After the clean preparation and dry run succeed:

```sh
npx wrangler deploy --config deploy/midnight-preview/wrangler.json
```

Always pass this explicit configuration. Do not deploy the default `wrangler.jsonc`, change either existing preview Worker, or add production routes/custom domains. No database migrations, seed imports, or other database writes are needed: this visual refinement reuses the ten existing preview records. Do not rerun seed imports or migrations against the remote preview database.

The deployment wrapper denies admin and development routes, rejects all writes and community submissions, passes only `DB`, `ASSETS`, and the public `SITE_URL` to the application, and sets `noindex` headers plus a disallowing `robots.txt`. No administrative credential is configured. The D1 binding is shared with the original preview; the wrapper permits only read requests. Static scripts, CSS, and images bypass Worker execution and receive preview indexing headers. Nothing here purchases services, changes billing, or enables additional Cloudflare products.

The preview is publicly reachable for evaluation; `noindex` is not access control. Free account quotas apply across this preview, the original preview, and any other account resources. External map-provider limits still apply. Do not raise quotas by changing plans.

## Verify after deployment

Check the returned HTTPS URL on desktop and mobile layouts: homepage, `/map`, `/locations/stanley-hotel`, map tiles and markers, name/geographic search, filters, and profile links. Repeat browser/accessibility checks against that origin and inspect images, overflow, and reduced-motion behavior. Verify `/robots.txt` denies indexing; `/admin`, `/api/admin`, `/__debug`, `/__vite_ping`, `/cdn-cgi/local/`, and `/cdn-cgi/explorer` are unavailable; community writes return 403; other writes return 405. Confirm only the intended bindings were deployed and no secrets exist. Browser viewport simulation is not physical iPhone testing.
