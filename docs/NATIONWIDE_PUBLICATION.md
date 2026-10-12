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
`live-batches`, and verification results. Its research fingerprint is
`a21736313a51b784bc18f38ad63db993e0758ebdd8d49ecddda149dd0b77ef90`.
The publication revision is
`d891e774d536ac2d60f221b1c7a027892ba2e42090243cc52c24554016293d4d`.

From the repository root, inspect the frozen plan:

```sh
npx tsx scripts/nationwide-publish-run.ts check \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches
```

After clean application/photo preparation and deployment as described in
[the deployment guide](../deploy/midnight-preview/README.md), publish or resume:

```sh
npx tsx scripts/nationwide-publish-run.ts apply \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches \
  --remote --max-batches 1
npx tsx scripts/nationwide-publish-run.ts resume \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches --remote
```

Every apply/resume checks the entire original and planned catalog before skipping
checkpointed batches. Each transaction repeats exact before/after guards, so an
interrupted acknowledgement can be retried without duplicating records or audit
entries. Unexpected edits, identity collisions or changed input files stop the
operation. A completed rerun checks the database and skips every batch.

For an approved recovery, rollback processes the frozen batches in reverse order:

```sh
npx tsx scripts/nationwide-publish-run.ts rollback \
  --plan-dir /workspace/phasm-nationwide-publication/live-batches --remote
```

Rollback restores the two original image records exactly and removes only the
new records and audit entries owned by this revision. New member, moderation or
editorial references prevent deletion. An interrupted rollback resumes using the
same command. Keep the deployed images available until database rollback finishes.
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
