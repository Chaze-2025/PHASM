# Nationwide publication

The owner explicitly approved publishing the nationwide catalog on 2026-10-12.
The target is the existing public PHASM Worker at
https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev and its existing
`phasm-editorial-preview-db` database. Always use
`deploy/midnight-preview/wrangler.json`; the default configuration targets a
different application.

The reviewed catalog adds 2,723 published locations and installs 33 cleared
photographs. Two photographs replace existing placeholders; all other existing
location fields and all existing source IDs, pins and relationships are preserved.
The resulting catalog has 2,859 published locations, including the six existing
international entries, with 167 mapped locations. The 2,692 locations without
verified publishable coordinates remain available in search and lists. They do
not receive invented coordinates.

## Repeatable publication

`scripts/nationwide-publish.ts` generates deterministic SQL and performs no
network operations. `scripts/nationwide-publish-run.ts` freezes those SQL files,
verifies their hashes, and checkpoints individually completed batches. Its default
command only checks the plan. Remote changes require an explicit operation and
`--remote`. Research, photos, snapshots, SQL and receipts stay outside Git and
outside the public assets directory.

The private publication packet for this run is
`/workspace/phasm-nationwide-publication`. It contains the fresh preflight snapshot
and restorable SQLite database, the validated published catalog, frozen SQL in
`live-batches-v2`, and verification results. Its research fingerprint is
`a21736313a51b784bc18f38ad63db993e0758ebdd8d49ecddda149dd0b77ef90`.
The publication revision is
`d891e774d536ac2d60f221b1c7a027892ba2e42090243cc52c24554016293d4d`.

From the repository root, inspect the frozen plan:

```sh
npx tsx scripts/nationwide-publish-run.ts check \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches-v2
```

After clean application/photo preparation and deployment as described in
[the deployment guide](../deploy/midnight-preview/README.md), apply the additive
`0004_publication_lookup.sql` migration using the explicit deployment config.
It indexes audit ownership and the raw identity comparison, preventing repeated
full-table scans during publication as the catalog grows. Check the pending
migration list before applying. This changes no catalog content. Then publish
or resume:

```sh
npx wrangler d1 migrations list phasm-editorial-preview-db \
  --remote --config deploy/midnight-preview/wrangler.json
npx wrangler d1 migrations apply phasm-editorial-preview-db \
  --remote --config deploy/midnight-preview/wrangler.json
```

```sh
npx tsx scripts/nationwide-publish-run.ts apply \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches-v2 \
  --remote --max-batches 1
npx tsx scripts/nationwide-publish-run.ts resume \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches-v2 --remote
```

Every apply/resume checks the entire original and planned catalog before skipping
checkpointed batches. Each transaction repeats exact before/after guards, so an
interrupted acknowledgement can be retried without duplicating records or audit
entries. Unexpected edits, identity collisions or changed input files stop the
operation. A completed rerun checks the database and skips every batch.

For an approved recovery, rollback processes the frozen batches in reverse order:

```sh
npx tsx scripts/nationwide-publish-run.ts rollback \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches-v2 --remote
```

Rollback restores the two original image records exactly and removes only the
new records and audit entries owned by this revision. New member, moderation or
editorial references prevent deletion. An interrupted rollback resumes using the
same command. Keep the deployed images available until database rollback finishes.
The two supporting indexes remain after content rollback; they can continue to
serve subsequent imports without changing the restored records.
The previous Worker version is recorded in the private preflight report; code
rollback is a separate Cloudflare operation.

Future research and photo additions use the reusable nationwide import and photo
workflows, followed by a fresh publication snapshot and a new frozen plan. Do not
reuse this run's baseline or edit its SQL/manifest/checkpoint to import different
inputs. Deployment photo packages must include all previously published research
photos as well as newly approved assets.

## Verification

The complete local rehearsal verifies partial resume, duplicate-free reruns,
exact rollback of all original tables, source row identities, foreign keys and
full-text search integrity. Live verification must additionally compare the
complete catalog with the frozen expected data, inspect all 33 photo byte hashes,
confirm the 167 map points and all public listings, and exercise desktop/mobile
navigation. Administrative routes remain closed in the public deployment wrapper.

## Live publication result — 2026-10-12

Publication completed and live verification passed at 09:15 UTC.

| Item | Verified result |
| --- | --- |
| Public site | https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev |
| Worker version | `8d61ba61-04c7-4242-b223-cda862f69f79` at 100% traffic |
| Deployed application commit | `bf2d5c2af219db1345f4594e8571e53748cde9d0` |
| Publication tooling commit | `8942614` |
| Published locations | 2,859: 2,723 additions plus 136 preserved entries |
| Geographic coverage | All 50 US states and six preserved international entries |
| Map | 167 points; all prior pins retained |
| Searchable locations without coordinates | 2,692 |
| Installed research photographs | 33, with exact reviewed byte hashes |
| Sources / phenomena | 5,577 / 569 |
| Publication audit entries | 2,725, plus all 225 original entries |
| Publication checkpoint | Complete, 55 of 55 batches |
| Completed rerun | Zero content batches executed; zero rows written |
| Public catalog check | All 58 pages matched every expected summary field |
| Sitemap | All 2,859 location URLs present |
| Automated validation | 178 unit tests; 15 public browser/accessibility checks; five additional new-profile checks |

The final database snapshot exactly matches the frozen native catalog. Every
baseline location row ID, non-photo field, source row and original audit entry
was preserved; only the two approved baseline photo replacements changed image
fields. All 14 member/editorial-related tables remained empty. The only schema
changes were the two supporting indexes and their recorded migration. The
recoverable post-publication SQLite snapshot passed integrity and foreign-key
checks. Live rollback was not needed; exact rollback and rollback reruns were
verified in the independent full-catalog rehearsal.

The 55 content batches used 29,321 database reads and 48,704 writes. The final
completed-run check used 37,323 reads and zero writes. No account or plan upgrade
was made. An initial command-output parsing issue and transient Cloudflare API
errors were resolved before continuing; successful read-back verification followed
publication. The frozen active plan is `live-batches-v2`; earlier plan directories
were never used for content writes.

Private evidence is under `/workspace/phasm-nationwide-publication`:
`verification/publication-execution.json`, `verification/unit-tests.log`,
`verification/planner-full-verification.json`, `postflight/report.json`,
`postflight/published.sqlite`, and the reports/screenshots in `live-ui`.
Desktop/mobile checks used browser viewport emulation, not physical iPhone testing.
The code and operational guide are saved on GitHub branch
`codex/nationwide-research-2853`.
