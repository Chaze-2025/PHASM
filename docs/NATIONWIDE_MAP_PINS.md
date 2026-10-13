# Complete map coverage

After nationwide publication, the owner requested a map pin for every location
and confirmed that an unavailable website should not prevent a pin. This is a
separate geographic enrichment of the published catalog. Existing coordinates,
identities, stories, photographs, sources and member relationships are preserved.

New references use coordinates explicitly published by a cited location source,
an exact Census match to a supplied street address, or a named locality from an
authoritative gazetteer. Every new reference is marked `approximate`. Optional
`coordinateReference` metadata records its scope, readable label and source URL.
The interface distinguishes site references from town/area, county or state
references. These are not directions to an entrance or assertions of access.
Approximate references remain excluded from exact geographic structured data.

The map can load a complete bounded set of lightweight points and cluster them
in MapLibre. Coincident pins open a chooser, so multiple places at a shared area
reference remain individually selectable without moving their coordinates.

## Repeatable evidence collection

The read-only Python collectors cache their inputs and responses, retain source
hashes and identity evidence, and never update the catalog or a remote database:

- `scripts/nationwide-coordinate-sources.py`: coordinates embedded in already
  cited venue pages, with name/locality/state checks, geographic bounds, bounded
  concurrency and retries. Missing websites or ambiguous matches remain explicit
  results for the next source method.
- `scripts/nationwide-coordinate-addresses.py`: Census street-address matching,
  accepting only exact matches with the expected address identity and state.
  Interpolated street points remain approximate. Cached reruns are byte-identical.
- `scripts/nationwide-coordinate-localities.py`: Census places, townships and
  counties, plus GeoNames named populated places or geographic areas. Namesakes
  require explicit reviewed choices; no coordinate jitter is applied. Census
  source attribution and GeoNames CC BY 4.0 credit remain visible on profiles.

Each collector has command-line help. Keep the supplied research, downloaded
gazetteers, page caches, response receipts and review overrides outside Git and
outside public assets. This run uses `/workspace/phasm-pin-enrichment`.

Merge frozen evidence into a new review directory:

```sh
python scripts/nationwide-coordinate-merge.py \
  --catalog /workspace/phasm-nationwide-publication/postflight/locations-native.json \
  --sources /workspace/phasm-pin-enrichment/source-candidates-final.json \
  --addresses /workspace/phasm-pin-enrichment/addresses/candidates.json \
  --addresses /workspace/phasm-pin-enrichment/addresses-supplement-1/candidates.json \
  --addresses /workspace/phasm-pin-enrichment/addresses-supplement-2/candidates.json \
  --addresses /workspace/phasm-pin-enrichment/addresses-supplement-3/candidates.json \
  --localities /workspace/phasm-pin-enrichment/localities/localities.json \
  --output /private/new-coordinate-review
```

Pass `--addresses` again for each frozen supplementary address batch, and
`--overrides` for an explicit reviewed ID-to-reference JSON file. The merge refuses
unknown IDs, unsupported points, missing evidence, unfinished source collection
or incomplete final coverage. `--preview` produces a marked, non-publishable
review packet. It preserves every non-geographic native field and every existing
pin. A source/address conflict is reported and uses its labeled area reference
until separately reviewed. Review geographic-distance warnings before publication.

The report includes a deterministic input fingerprint, decisions, preserved-pin
count, method/scope counts and a complete resulting native catalog. Repeating
the merge with identical frozen evidence produces identical catalog bytes.

## Coordinate-only publication

`buildCoordinatePlan` in `scripts/nationwide-publish.ts` and the transport's
`plan-coordinates` command accept only changes to `latitude`, `longitude`,
`coordinatePrecision`, and `coordinateReference` on previously unmapped records.
They reject record additions/removals, changes to existing pins, or any content,
photo, source, status or timestamp changes. Each batch checks exact before/after
state and audit ownership; resume and rollback use the same frozen plan.

```sh
npx tsx scripts/nationwide-publish-run.ts plan-coordinates \
  --snapshot-dir /workspace/phasm-nationwide-publication/postflight \
  --catalog /private/new-coordinate-review/catalog.json \
  --input-hash VERIFIED_REVIEW_FINGERPRINT \
  --output /private/new-coordinate-plan
npx tsx scripts/nationwide-publish-run.ts check \
  --plan-dir /private/new-coordinate-plan
```

Before live changes, rehearse application, interruption recovery, unchanged reruns
and exact rollback on an independent copy of the current database. Migration
`0005_fts_update_guard.sql` avoids rewriting full-text search data when only
coordinates or other non-indexed fields change; name, city, state, country and
row-ID changes still maintain the search index. This reduces unnecessary writes
on the existing free plan. Apply only reviewed pending migrations with the
explicit deployment configuration from the existing publication guide.

Deploy the clean committed UI and all existing reviewed photos first:

```sh
node deploy/midnight-preview/prepare.mjs \
  --photo-workspace /workspace/phasm-nationwide-review/full \
  --photo-patch-version nationwide-photos-2026-10-12-v2
npx wrangler deploy --config deploy/midnight-preview/wrangler.json --dry-run
npx wrangler deploy --config deploy/midnight-preview/wrangler.json
```

Use the existing exact Worker and D1 target. Apply the frozen coordinate plan
with `apply --remote`, continue with `resume --remote`, or restore the original
null coordinates and remove only this run's audits with `rollback --remote`.
Never delete or edit a checkpoint to change its inputs. The supporting FTS
migration remains after a content rollback.

Final verification must compare every live native record with the reviewed
catalog, preserve all original relational rows and 167 existing pins, confirm
all locations are represented by the map response, verify profile scope/source
labels and overlapping-pin selection, and repeat the completed plan with zero
additional writes.

## Reviewed nationwide pin dataset — 2026-10-13

The frozen review contains 2,859 published locations: 167 existing pins preserved
unchanged and 2,692 new approximate references. Of those additions, 1,893 use
source-map coordinates, 129 use Census street matches, and 670 use named area
references (664 locality/park references and six county references). No record
remains without a map point. Unavailable websites do not exclude a location.

Old Faithful Inn's source-map and street-match candidates disagree by 47.49 km.
The reviewed result deliberately uses a labeled Yellowstone National Park
reference from GeoNames (5843642); it does not claim an exact inn location.

Frozen review: `/workspace/phasm-pin-enrichment/final-review/`.

- Input fingerprint: `e98bb0f89782914b99b3b5d79a3a6968525450e4a80d47ce0e9594fdb3e343f6`.
- Native catalog before: `6781bcbff532809f9f074e4939c0c6ec82cb5634af41f19c65a8d21c2557bf80`.
- Native catalog after: `232179abf61f28f55b47a205b72206a495c63583f17fb768de58856d9c3b9eab`.

The fresh live backup and all 19 ordinary tables matched the previous publication
exactly before this update. Source and locality collectors passed cached rerun
checks. The live deployment and database verification are recorded below.

## Live publication — 2026-10-13

Published to <https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev/map>.

- Application source commit: `96e32da75492118a0e0ad978ebda7901e7ab9623`.
- Worker version: `bac4c33b-c9ae-4686-b400-c9210b81e32d`.
- D1 database: `phasm-editorial-preview-db`,
  `fe55176f-43e7-4b79-82c2-02884e4161a0`.
- Coordinate revision: `35e8341fe37ecbf0b7e48e71a015ca1e8e02688ef3e0d3ae27c2315b5c4fcecf`.
- Frozen plan: `/workspace/phasm-pin-enrichment/live-plan` (54 completed batches).
- Plan manifest SHA256: `584f3f824af61159d7295a47154048a292944106cc718dc42edb9e561ba690cb`.
- Migration: only `0005_fts_update_guard.sql` was pending and applied.

The public point feed returns all **2,859 unique location IDs**, exact reviewed
coordinates and `truncated: false`. Its payload is 729,313 bytes (109,713 bytes
when gzip-compressed). The bounded default cluster feed also accounts for all
2,859 places. A complete filtered point feed stays in the browser across camera
moves, avoiding repeated atlas requests while panning and zooming.

Fresh D1 readback matches all 2,859 reviewed native records. The 167 original
mapped records remain byte-for-byte unchanged at the raw row level. All
non-geographic fields, source/phenomenon rows and original row IDs/audits are
preserved. The 2,692 new coordinate audits bring the total to 5,642. All 14
member/editorial tables remain unchanged. Recovery checks pass database,
foreign-key and full-text integrity using the actual live FTS bytes.

All 33 cleared research photos were included with unchanged hashes and URLs.
The deployment preserves the read-only wrapper and existing free resources.
Repeating the completed live plan checks the exact catalog and performs **zero
content batches and zero row writes**. Repeating the evidence merge produces
identical catalog/report bytes and fingerprint; decision objects retain identical
content, with object-key ordering allowed to vary between Python processes.

Validation: 192 TypeScript tests, 23 Python coordinate tests and Census parser
checks passed; import type-check, production build and deployment dry run passed.
The actual-data rehearsal proved partial resume, unchanged reruns, preservation
of all 19 ordinary tables and exact reverse rollback before publication.

Live browser checks passed at 1440px and 390px: all 2,859 IDs were present,
repeated pan/zoom used one atlas request, and the real overlapping Destrehan and
Ormond Plantation pins remained individually selectable without official website
URLs. Site/town/county labels, access text, existing photographs and external map
tiles passed. The public regression suite passed 15/15, including automated
accessibility scans, with no uncaught application errors. Mobile checks use browser
viewport simulation rather than physical iPhone hardware.

Private evidence and recovery files:

- `preflight/baseline.sqlite`: pre-update recovery database.
- `rehearsal/report.json`: full apply/resume/rollback verification.
- `verification/deployment-source.json`: clean source and photo provenance.
- `verification/public/report.json`: live point, cluster and search checks.
- `verification/completed-rerun-proof.json`: zero-write live rerun.
- `live-ui/results.json`: real-data desktop/mobile map and reference checks.
- `live-regression/phasm-qa-results.json`: public browser regression and accessibility checks.
- `postflight/report.json` and `postflight/published.sqlite`: verified live snapshot.

These paths are relative to `/workspace/phasm-pin-enrichment`. The frozen plan
retains guarded rollback SQL for every batch. A coordinate rollback restores
only this revision's changed coordinates/metadata and removes its owned audits;
all previously published locations remain present. Migration 0005 stays applied.
