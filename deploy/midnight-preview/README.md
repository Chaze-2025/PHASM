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
`codex/rolling-fog` and `codex/responsive-performance` revisions. The
[performance update](../../docs/PERFORMANCE.md) uses this same isolated Worker
and database without migrations or catalog writes.

For local review before committing, `node deploy/midnight-preview/prepare.mjs --allow-dirty` permits a marked, uncommitted build. Use that output only for local checks and Wrangler's `--dry-run`. Before a real deployment, commit reviewed changes and rerun preparation **without** `--allow-dirty`.

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
