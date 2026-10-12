# PHASM editorial voice preview update

This directory updates the existing isolated evaluation Worker with the editorial voice and neutral charcoal map refinement. It uses a separate preview database so edited text cannot change the preserved Phase 1 and Phase 1.1 previews. Production configuration, original development branches, and the former shared preview database remain preserved.

| Resource                    | Target                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| Branch                      | `dev/phasm-editorial-voice`                                         |
| Preview Worker              | `phasm-phase-1-3-preview`                                           |
| Preview origin              | `https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev`            |
| Isolated editorial D1       | `phasm-editorial-preview-db`                                        |
| Editorial D1 UUID           | `fe55176f-43e7-4b79-82c2-02884e4161a0`                              |
| Preserved original D1       | `phasm-phase-1-preview-db` (`30400e9a-8eb0-4605-a3a4-0db6470301d1`) |
| Preserved Phase 1.1 preview | `https://phasm-phase-1-1-preview.wj7djnw2j2.workers.dev`            |
| Preserved Phase 1 preview   | `https://phasm-phase-1-preview.wj7djnw2j2.workers.dev`              |

The origin already hosts an evaluation preview. Its presence alone does not prove that a particular editorial revision has been deployed. Verify the source commit, deployed binding, and rendered update before sharing completion.

## Prepare and inspect

Run from the repository root after installing locked dependencies with `npm ci`:

```sh
node deploy/midnight-preview/validate-config.mjs
node deploy/midnight-preview/prepare.mjs
npx wrangler deploy --config deploy/midnight-preview/wrangler.json --dry-run
```

Preparation requires the expected branch, a clean working tree, and the preserved Phase 1 (`9da8948`), Phase 1.1 (`cf915ba`), Midnight Séance (`d3c7a21`), and atmospheric fog (`8ffeb28`) commits as ancestors. It performs a fresh production build, copies public assets into ignored `.generated/assets`, adds preview-only indexing headers, and records the exact source commit in `.generated/source.json`. Vite packages the MapLibre browser worker through the application's asset import.

The preparation allowlist also includes the subsequent `codex/usa-atlas-130`,
`codex/rolling-fog`, `codex/responsive-performance`, `codex/volumetric-mist`,
and `codex/nationwide-research-2853` revisions. The
[performance update](../../docs/PERFORMANCE.md) uses this same isolated Worker
and database without migrations or catalog writes.

For local review before committing, `node deploy/midnight-preview/prepare.mjs --allow-dirty` permits a marked, uncommitted build. Use that output only for local checks and Wrangler's `--dry-run`. Before a real deployment, commit reviewed changes and rerun preparation **without** `--allow-dirty`.

## Nationwide catalog and cleared photographs

The owner approved publication of the 2,723 nationwide additions on 2026-10-12.
The public origin and exact existing Worker/D1 bindings in the table above remain
the deployment targets. This approval does not authorize a paid plan, a new
service, changing another preview, or opening the wrapper's administrative routes.

On `codex/nationwide-research-2853`, preparation requires an explicit completed
photo workspace. The reviewed workspace contains 33 independently cleared image
files, totaling 24,819,976 bytes. The one missing supplied photograph and the
three quarantined Wyoming image choices are not packaged. Existing approved
public images remain in the regular application build.

```sh
node deploy/midnight-preview/prepare.mjs \
  --photo-workspace /workspace/phasm-nationwide-review/full \
  --photo-patch-version nationwide-photos-2026-10-12-v2
npx wrangler deploy --config deploy/midnight-preview/wrangler.json --dry-run
```

The workspace path is explicit and may differ on another machine. Omitting
`--photo-patch-version` selects the version in its `photo-plan.json`. For local
checks of uncommitted code, add `--allow-dirty`; prepare again from a clean commit
before deploying. Preparation itself never writes D1 or deploys a Worker.

Photo preparation verifies the frozen manifest and plan hashes, the complete
photo run and every applied operation in `journal.sqlite`, its individual asset
receipts, and matching image fields in `catalog.sqlite`. Every catalog reference
under `/images/research/` must be covered by the selected completed patch. This
prevents accidentally dropping an already referenced image; a future partial
photo patch needs a cumulative reviewed deployment package before preparation.
Only the installed, content-addressed JPG/PNG/WebP/AVIF files under the workspace's
`assets/images/research/` are eligible. Symlinks, path escapes, substituted bytes,
catalog edits, incomplete runs and conflicting existing assets stop preparation.
All assets are checked against Workers Free's 20,000-file and 25 MiB-per-file
limits. These checks do not change Cloudflare's account or billing settings.

The ignored `.generated/source.json` records source commit, patch version,
manifest/plan/run hashes, total bytes, and each installed image's hash, attribution,
license, source URL and review metadata. It excludes local source paths, the raw
research, database contents and credentials; it is operational provenance, not a
public website asset. The bulk images, databases and reports remain outside Git.
Repeated preparation copies the same approved bytes to the same URLs.

Apply only the separately reviewed, guarded nationwide publication plan to the
explicit editorial database, preserving existing records and relationships.
Application/asset deployment and D1 publication are distinct operations; the
preparation script does not imply that records have been imported or published.
Keep the pre-publication database snapshot, rollback SQL and deployment provenance
with the private operational review packet, then verify public totals and images
against that plan after the deployment and D1 update.

## Preview database isolation

The editorial database was created as a separate free D1 database after verifying the account's database count and storage against the documented free limits. Its initial content is an exact copy of all 19 ordinary tables, including row IDs, source relationships, migration records, and editorial audit records, from the original preview. Indexes, triggers, and the FTS5 definition were preserved; the derived FTS index was rebuilt in the clone. Schema, row, migration sequence, foreign-key, and search parity were verified before editing public copy.

Cloudflare's full SQL export currently rejects databases containing virtual tables. The clone process exported ordinary tables explicitly, read the original `sqlite_master` definitions, then restored those tables plus the exact indexes, FTS definition, and triggers into the new database. Export files and internal records are private operational artifacts outside this repository. Do not publish them as website assets.

Do not reseed or bulk-replace locations to apply editorial revisions. Use a reviewed, guarded update that changes only the approved public text fields and individually reviewed source URL repairs. Preserve source row IDs, unrelated JSON fields, existing audit records, timestamps, and all other internal metadata. Record each approved copy refinement with an appended audit entry. Apply it only to `phasm-editorial-preview-db` after validating the expected existing data. The original shared preview database must remain unchanged. The reviewed revision generator performs no database operations:

```sh
npx tsx scripts/editorial-revision.ts /tmp/phasm-editorial-review.sql
```

Use a new private output path, inspect the generated SQL, validate the exact editorial database binding, then apply only to the clone:

```sh
node deploy/midnight-preview/validate-config.mjs
npx wrangler d1 execute phasm-editorial-preview-db --remote --config deploy/midnight-preview/wrangler.json --file /tmp/phasm-editorial-review.sql --yes
```

The generator places all baseline guards before writes, permits the already-applied revision, updates explicit JSON fields and source URLs in place, and appends audit rows only for newly applied revisions. A reviewed rerun is idempotent. Verify the clone against `content/locations.json` and confirm the original database is unchanged afterward. See [the editorial preview record](../../docs/editorial/PREVIEW.md).

## Update the preview

Wrangler must be authenticated to the existing account. Verify with `npx wrangler whoami`; if authorization expires, complete Wrangler's supported login flow. Never commit tokens or put credentials in client variables. The owner confirmed **Workers Free**. Do not upgrade the plan or enable paid services.

After the reviewed content update, clean preparation, and dry run succeed:

```sh
npx wrangler deploy --config deploy/midnight-preview/wrangler.json
```

Always pass this explicit configuration. Do not deploy the default `wrangler.jsonc`, update the separate Phase 1 or Phase 1.1 Workers, or add production routes/custom domains. The validator restricts the binding to the editorial database's exact name and UUID.

The wrapper denies admin and development paths, rejects writes and community submissions, forwards only `DB`, `ASSETS`, and public `SITE_URL`, and sets `noindex` headers plus a disallowing `robots.txt`. No administrative credential is configured. Static assets bypass Worker execution and receive preview indexing headers. No paid service, R2 binding, or observability feature is enabled.

The preview is publicly reachable for evaluation; `noindex` is not authentication. Account-wide free usage limits and external map-provider limits apply. Exceeding the free D1 daily allowance causes query errors; do not change plans to raise quotas.

## Verify after deployment

Check homepage, `/map`, `/locations/stanley-hotel`, map tiles and markers, search, filters, all location profiles, source links, images, overflow, reduced motion, and accessibility on desktop and mobile viewports. Confirm the deployed application uses the exact reviewed text, unchanged geography, and neutral charcoal map while the original preview catalog retains its former fingerprint.

Verify `/robots.txt` denies indexing, admin/development paths remain unavailable, community writes return 403, and other writes return 405. Confirm the intended three bindings and an empty secrets list. Record the HTTPS URL, Worker version, source commit, and verification results in the handoff. Browser viewport simulation is not physical iPhone testing.
