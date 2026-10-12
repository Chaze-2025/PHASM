# PHASM

A cinematic field guide to haunted places, documented history, and attributed folklore. Phase 1 delivers a working Haunted Atlas, reusable location profiles, and a private editorial API on React, TypeScript, Vite, Cloudflare Workers, and D1.

Current work: **`codex/usa-atlas-130` — 136 sourced profiles with map points**, including 130 US locations across all 50 states and six preserved international profiles. The 75 newly researched points are approximate references to identified sites, parks, roads or visitor locations; the original 61 points remain unchanged. The coordinate update is prepared for deployment. See [the USA atlas integration](docs/USA-ATLAS-130.md) for the deployed baseline and current release status. The green-and-brass design, neutral charcoal map, photography, homepage mist and closed community features remain intact.

[Editorial refinement and voice](docs/editorial/README.md) · [Source review](docs/editorial/SOURCE-REVIEW.md) · [Screenshots and QA](docs/editorial/QA.md)

[Atmospheric fog implementation](docs/fog/README.md) · [Fog screenshots, recording, and QA](docs/fog/QA.md)

[Phase 1.3 visual review](docs/phase-1-3/README.md) · [Design system](docs/phase-1-3/DESIGN-SYSTEM.md) · [Before/after screenshots](docs/phase-1-3/screenshots.md) · [Isolated Cloudflare preview](https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev) · [Preview deployment instructions](deploy/midnight-preview/README.md)

The preview is separate from production and now uses its own editorial D1 copy, preserving the original database and earlier previews. Administrative and development routes are denied, submissions remain closed, and no paid services are enabled. Previous [Phase 1](https://phasm-phase-1-preview.wj7djnw2j2.workers.dev) and [Phase 1.1](https://phasm-phase-1-1-preview.wj7djnw2j2.workers.dev) previews remain available for comparison. See the [Phase 1.1 review](docs/phase-1-1/README.md) for earlier evidence.

## Run locally

Use Node.js **22.13+ or 24** and npm. Tests use Node's built-in SQLite module. No Cloudflare account, map API key, or paid service is needed for local development.

```bash
cd /path/to/PHASM
npm ci
npm run setup
npm run dev
```

Open **http://localhost:5173**. The Cloudflare Vite plugin runs the Worker API and local D1 alongside the frontend. Internet access is needed for the map basemap; location search and profiles use the local database.

`setup` applies local migrations and inserts missing seed records. Seeding preserves existing records with the same IDs, including editorial changes; it fails on conflicting identities instead of overwriting them. Local D1 data lives under the ignored `.wrangler/` directory. Neither setup command writes to a remote database. To restart the site later, run `npm run dev`; reseeding is not required.

Useful preview routes:

| Route                      | Available behavior                                                      |
| -------------------------- | ----------------------------------------------------------------------- |
| `/`                        | Discovery homepage, destination search, featured places, region links   |
| `/map`                     | Interactive atlas, clustering, search, filters, previews, list view     |
| `/locations/stanley-hotel` | Sourced example profile, visiting links, image credit, related places   |
| `/saved`                   | Saved places in this browser only; no account or device synchronization |
| `/encyclopedia`            | Introductory descriptions of the reported-phenomenon tags               |
| `/about`                   | Editorial classifications and visiting principles                       |
| `/cases`, `/account`       | Clearly identified planned features                                     |
| `/admin`                   | Editorial access gate and authenticated location editor                 |

## Editorial access

Administrative API routes fail closed unless the Worker has an `ADMIN_TOKEN` of at least 32 characters. The editor stores the entered token only in React memory; reload or lock the workspace to clear it. It is not persisted in local storage.

For a fresh local checkout, generate a 64-character random token directly into the ignored `.dev.vars` file without printing it:

```bash
node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { writeFileSync } from "node:fs"; writeFileSync(".dev.vars", "ADMIN_TOKEN=" + randomBytes(32).toString("hex") + "\n", { mode: 0o600, flag: "wx" });'
```

This intentionally refuses to overwrite an existing `.dev.vars`. If that file already exists, preserve its settings and add a strong `ADMIN_TOKEN` through your private editor or secret manager. Restart `npm run dev`, open `/admin`, and copy the value from your local file into the password field without sharing it in logs, screenshots, or source control.

The editor can add drafts and edit identity, coordinates, classification, history, reported activity, sources, image metadata, visitor information, tags, and publication status. Publishing makes the record visible immediately in the running environment. The current credential is a shared editorial secret, not a multi-user identity system. Public deployment requires stronger identity controls and the launch checks below.

| Setting              | Where                                       | Purpose                                                                                |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`        | Local `.dev.vars`; production Worker secret | Privileged editorial credential; never use a `VITE_` prefix                            |
| `SITE_URL`           | Worker vars in `wrangler.jsonc`             | Canonical origin for sitemap, profile metadata, and social images; localhost initially |
| `DB`                 | D1 binding in `wrangler.jsonc`              | Local/remote structured catalog database                                               |
| `ASSETS`             | Workers Static Assets binding               | Built frontend and local media                                                         |
| `VITE_MAP_STYLE_URL` | Optional `.env` setting                     | Public MapLibre style URL; defaults to OpenFreeMap Dark                                |

No client-side secrets are required. Never place privileged values in Vite variables, frontend source, or committed configuration.

## Content and imports

The catalog contains **136 locations, all with map points**. The October 10 research handoff added 126 locations and updated four existing US IDs. Subsequent geographic research supplies approximate reference points for all 75 profiles that initially lacked coordinates, preserving the other 61 records. The [coordinate registry](content/research/usa-130-geocodes.json) records each inspected source, numeric pair, point kind, evidence and inspection date. The public bibliography retains all 431 original source records and adds 75 geographic references, which do not serve as evidence for historical or paranormal claims.

Profiles distinguish historical information from attributed paranormal reports; history is optional when the research supports only a sourced story. A map point does not establish permission to enter: private ownership, booking requirements, closures and other access restrictions still apply. Approximate means a reference to the identified feature, with the source's numeric coordinates retained; it does not require rounding to a town-sized area. Existing approved imagery is retained and new profiles use a clearly labelled nonphotographic placeholder. No member reviews or ratings were added. See [the USA atlas integration](docs/USA-ATLAS-130.md) for provenance, verification and deployment status.

Read [content research and image licensing](docs/CONTENT.md) and [image credits](content/image-credits.json) before editing. These records are published in the local database for evaluation, but all require another editorial review before a public launch.

```bash
# Validate the bundled content without writing to a database.
npm run import:validate

# Validate a reviewed candidate file and generate reviewable SQL only.
npm run import:validate -- /path/to/reviewed-locations.json --write-sql /tmp/phasm-import.sql
```

The import tool accepts 1–5,000 records per file and rejects malformed records and duplicate IDs, slugs, or normalized name/city/state/country identities within a batch. Database uniqueness constraints also reject collisions with existing records. It validates required publication sources, bounds, URL schemes, image metadata, and privacy rules. Validation does not establish historical truth, media rights, or visiting permission: an editor must check those.

To update the already imported 136-record atlas, generate the dedicated guarded coordinate revision with `npx tsx scripts/geocode-revision.ts /private/path/geocodes.sql`. It uses deployed source `9d76541aec32d093a2caa2f3d2a617d73ebe22f3` as its baseline, protects the 61 previously mapped records and updates the 75 newly researched pins. This command generates SQL only; follow the integration guide for backup, review and deployment.

Keep candidate files and generated SQL private, use draft publication status until reviewed, and inspect the complete SQL before applying it to a database. SQL generation does not apply the import. Existing records are not silently updated by bulk import. The private editor is the supported Phase 1 editing interface; a guided bulk-import administration screen is still planned.

## Verification

```bash
npm test
npm run build
npm run deploy:check
```

`npm test` exercises validation, publication visibility, search, geographic bounds, a 5,100-record aggregation case, authorization, duplicate handling, and disabled community writes against SQLite. It does not measure Cloudflare production CPU usage or replace browser/mobile testing. `deploy:check` builds and runs **`wrangler deploy --dry-run` only**; it does not publish the site.

Initial Phase 1 results: **8 backend tests, 16 browser checks, and 7 automated accessibility scans passed**. The production build and Cloudflare deployment dry run passed. Both runtime-only and full dependency audits reported zero known vulnerabilities on 8 October 2026. See [the QA record](docs/QA.md) for evidence and remaining manual/device coverage.

The [USA atlas integration](docs/USA-ATLAS-130.md) distinguishes the initial import's recorded verification from the pending coordinate update. Earlier results remain in [editorial verification](docs/editorial/QA.md), [fog verification](docs/fog/QA.md) and [Phase 1.3 verification](docs/phase-1-3/TEST-RESULTS.md).

For browser checks, start the development server, run `npx playwright install chromium`, then `npm run test:browser`.

MapLibre is on the patched 6.13 release line. The `sharp` override patches a transitive development dependency in the Cloudflare toolchain; revisit it when that toolchain adopts the patched version.

## Architecture and limits

See [architecture](docs/ARCHITECTURE.md) for routes, storage, security boundaries, and extension points. The atlas requests a geographic bounding box and receives at most 500 points or aggregated bins; text search uses D1 FTS5. This keeps map payloads bounded beyond 5,000 locations. Geographic search covers the editorial catalog, not arbitrary worldwide addresses.

[Service terms and quotas](docs/SERVICES.md) were checked against official sources on 8 October 2026. Key limits include Workers Free's 100,000 requests/day and 10 ms CPU/request, D1 Free's 5 million scanned rows/day and 500 MB per database, and OpenFreeMap's lack of an SLA. R2 is not configured; its free egress does not make storage and operations unlimited. Production CPU, query throughput, abuse limits, and sustained mobile performance remain launch work.

## Before a production launch

This is a manual readiness checklist, not a record of completed provisioning:

1. Obtain deployment authorization and select the Cloudflare account and plan. Create a D1 database, replace the placeholder `database_id` with its real ID, and apply reviewed migrations/content to that database only after a backup and recovery plan is in place.
2. Set `SITE_URL` to the final HTTPS canonical origin. Configure `ADMIN_TOKEN` as a Worker secret through Cloudflare's secret workflow; never commit it. Protect `/admin` and `/api/admin/*` behind an identity gateway such as Cloudflare Access, or implement equivalent server-verified per-editor authentication with authorization and MFA. The shared token alone is a Phase 1 foundation.
3. Complete security and accessibility review, real iPhone/mobile testing, production CPU/query benchmarks, rate limiting, quota alerts, restore testing, and map outage checks. Account for direct asset versus Worker routing costs.
4. Recheck every location's facts, access, privacy, sources, and image license, and complete second-editor review of the entire release catalog.
5. Keep public reviews, suggestions, uploads, replies, accounts, and synced collections closed until their authentication, permissions, moderation, consent, reporting, appeals, spam prevention, and abuse controls are implemented and tested.
6. Recheck Cloudflare/OpenFreeMap terms, run the documented checks, inspect the preview, and perform deployment only after explicit authorization. No `deploy` script is provided.

## Next development milestones

- Maintain and review the expanded catalog, improve regional coverage, and build reviewed case files and Haunted Trails.
- Add a richer licensed media gallery, source review tracking, and a guided private import workflow.
- Replace the shared editorial credential with per-editor identity, fuller audit history, and operational protections.
- Implement secure community accounts and the unified moderated review system, followed by synchronized collections.
- Finish production performance, security, accessibility, restore, and deployment readiness checks.
