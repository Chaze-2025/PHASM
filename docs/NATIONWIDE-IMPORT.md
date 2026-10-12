# Repeatable nationwide research import

This workflow prepares an isolated **local** editorial preview. It has no remote-write transport. Publication, merging, production deployment, and live D1 changes require the owner's separate approval. New research locations remain drafts; the private review UI does not publish them.

The source of truth is D1 `locations.data_json`, together with relational projections, sources, phenomena and member/editorial relationships. The current preflight found 136 live records identical to the repository fixture: 130 U.S. and six international. Start commit: `ad5bdec0da6a0fb28daa09968121459fdae39cce`. Work branch: `codex/nationwide-research-2853`.

## Inputs and immutable extraction

Use Node 24+, `npm ci`, and Python 3 for ZIP extraction. Keep raw files, private snapshots, image evidence and generated reports outside Git. The supplied data ZIP is 7,787,428 bytes with SHA-256 `f7efc43f8c82fb5edb94db6c283e5230590afa492dc96f7c5b16ae5e85f14079`. It contains 628 individually checksummed data files, the checksum manifest itself, and an additional packaging note covered by the ZIP hash. The image archives are optional for importing content.

This extraction rejects unsafe paths, symlinks, and conflicting existing files. Repeat it for each available archive into the same parent; do not nest or replace the shared package directory. Individual images must be placed at their exact `index/INCLUDED_IMAGE_FILES.json` paths and match the registered SHA-256.

```bash
python - DATA.zip /absolute/research-input <<'PY'
import pathlib, stat, sys, zipfile
archive, parent = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None, 'ZIP CRC failure'
    for item in z.infolist():
        p = pathlib.PurePosixPath(item.filename)
        assert not p.is_absolute() and '..' not in p.parts and '\\' not in item.filename, p
        assert not stat.S_ISLNK(item.external_attr >> 16), p
        target = parent.joinpath(*p.parts)
        assert target.resolve().is_relative_to(parent), p
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        data = z.read(item)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert target.read_bytes() == data, f'Conflicting input: {p}'
        else:
            target.write_bytes(data)
PY
```

Set paths for this review (adjust them when reproducing elsewhere):

```bash
PHASM_INPUT=/workspace/phasm-nationwide-review/input/PHASM_50_State_Research_Handoff_2853_2026-10-12
PHASM_SNAPSHOT=/workspace/phasm-nationwide-review/preflight/baseline.sqlite
PHASM_REVIEW=/workspace/phasm-nationwide-review
```

The recoverable preflight snapshot includes original rowids, source IDs, phenomena, audit rows, indexes, FTS and triggers. Its private companion manifests record table hashes, live comparison and integrity/FK recovery checks. No credentials are included in those reports. For a future live import, obtain a fresh read-only snapshot and reconcile any drift rather than resetting live data to this snapshot.

Strict verification of the supplied files, with the one known missing asset explicitly allowed:

```bash
npx tsx scripts/nationwide-verify.ts \
  --input "$PHASM_INPUT" \
  --allow-missing-image checkpoints/PHASM_Checkpoint_06_MT_NE_NV_NH_NJ_338_2026-10-12/montana/images/montana-state-prison-museum.jpg \
  --zip /workspace/phasm-nationwide-intake/PHASM_Research_Data_2853_2026-10-12.zip \
  --zip-sha256 f7efc43f8c82fb5edb94db6c283e5230590afa492dc96f7c5b16ae5e85f14079 \
  --report "$PHASM_REVIEW/verification.json"
```

For data-only extraction use `--data-only` instead of `--allow-missing-image`. When all 34 assets are available, omit both flags and run `python "$PHASM_INPUT/verify_handoff.py"`. The unchanged bundled verifier currently fails only for the missing Montana image; that is **not** a complete-bundle pass. Present hashes, 2,853 pointers, crosswalk identities and all 50 state counts pass the separate strict verifier. The two original photo ZIPs were not supplied and their archive hashes are not claimed verified.

## Dry run, pilot, apply and resume

No command defaults to applying data. `dry-run` and `validate` read the input and snapshot; files are written only when an explicit report destination is supplied. `--allow-missing-images` permits only absent assets registered in the package and enumerates them in the report. It never suppresses missing research, bad hashes, unsafe paths or pointer errors.

```bash
npm run import:nationwide -- dry-run --input "$PHASM_INPUT" \
  --snapshot "$PHASM_SNAPSHOT" --allow-missing-images \
  --report-dir "$PHASM_REVIEW/dry-run"

npm run import:nationwide -- prepare --snapshot "$PHASM_SNAPSHOT" \
  --workspace "$PHASM_REVIEW/my-pilot"
npm run import:nationwide -- plan --input "$PHASM_INPUT" \
  --workspace "$PHASM_REVIEW/my-pilot" --selection pilot --allow-missing-images
npm run import:nationwide -- apply --input "$PHASM_INPUT" \
  --workspace "$PHASM_REVIEW/my-pilot" --batch-size 10 --max-batches 1 --allow-missing-images
npm run import:nationwide -- resume --input "$PHASM_INPUT" \
  --workspace "$PHASM_REVIEW/my-pilot" --batch-size 10 --allow-missing-images
```

`prepare` uses SQLite backup, including committed WAL data, to create a consistent immutable `baseline.sqlite` and a separate `catalog.sqlite`. It refuses to replace a workspace. `plan` freezes ordered native operations with original row/relationship snapshots in `run.json`. A plan cannot be replaced with different inputs. Default batches are 100, maximum 500. `--max-batches` is a deliberate resumable stop, useful for demonstrating recovery.

The deterministic 25-record pilot covers baseline preservation, all semantic narrative/source families, sparse/rich stories, private/unknown access, reviewed/missing/explicitly withheld coordinates, a cleared photo candidate, the three Wyoming quarantines, and the four named editorial exceptions. There are no actual baseline content updates in this package; synthetic tests exercise conservative enrichment and relationship preservation. The pilot adds 18 drafts and preserves all 136 existing places, producing 154 records.

Inspect the pilot before preparing the full independent workspace:

```bash
npm run import:nationwide -- prepare --snapshot "$PHASM_SNAPSHOT" \
  --workspace "$PHASM_REVIEW/my-full"
npm run import:nationwide -- plan --input "$PHASM_INPUT" \
  --workspace "$PHASM_REVIEW/my-full" --selection full --allow-missing-images
npm run import:nationwide -- apply --input "$PHASM_INPUT" \
  --workspace "$PHASM_REVIEW/my-full" --batch-size 100 --allow-missing-images
npm run import:nationwide -- report --workspace "$PHASM_REVIEW/my-full"
```

Repeat `apply`/`resume` against the same frozen plan to prove a no-op. New content timestamps use the research date, not wall-clock time. Already-applied records must still match their saved after-images. Input hashes and importer versions must match; modifying either requires a new reviewed plan/workspace. Changes to any affected row, source or phenomenon cause a conflict rather than overwriting an editor. Future adapter behavior changes require a version bump.

The attached `journal.sqlite` records before/after images, audit ownership and batch state. Both databases use DELETE journaling and FULL synchronization so SQLite's super-journal commits the app writes and checkpoint together. Keep both files in the same local workspace/filesystem. Do not manually edit or remove journal entries. The application schema is unchanged.

## Review reports and field policy

`reports/REPORT.md` and `summary.json` summarize dispositions. `records.json` retains every indexed input, its untouched raw record, source namespace/claim associations, field decisions, warnings and unsupported detail. `crosswalk.json` records stable research/app IDs and before/after hashes. `catalog.json` is the planned combined catalog; `current-catalog.json` is an applied content checkpoint. Media changes are tracked separately, so use the database or `export` after photo patches.

- `PROFILE_INDEX` is the counting authority; duplicate checkpoint aggregates are never concatenated. RFC 6901 pointers resolve against original artifacts.
- Baseline IDs, slugs, approved media, richer narratives, publication states and coordinates are retained. No research aliases duplicate the four protected established IDs. The six international locations and all member tables remain intact.
- New places use native categories/access/classification and remain drafts. `contentReady` means a mechanically complete candidate with source support; it is not editorial approval. Import-valid, image-ready and published are separate measures.
- Missing locality is left empty; conflicting Hiwan/Lace locality proposals remain review notes. Pueblo's different building/photo subjects are not conflated.
- All 130 existing U.S. pins remain. Of 73 research pairs, 41 overlap baseline and 32 are new. Thirty-one new sourced approximate pins are accepted; Cry Baby Hollow's explicitly withheld pair stays withheld. There are 167 mapped records including six international and 2,692 unmapped drafts. Nulls never become zero/city-center pins. Approximate points are not guaranteed entrances.
- Full stories are retained, not shortened to fit limits. Overflow, unresolved roles and conflicts are reported with raw sidecars. History, reported folklore, visiting evidence and photo licenses remain distinct.

## Versioned photo patches

See [NATIONWIDE-MEDIA-REVIEW.md](NATIONWIDE-MEDIA-REVIEW.md). Independent review manifests identify exact bytes, stable research ID, creator, license/version/link, source page, original URL/hash, evidence hash, attribution, review date, subject match and transformations/ShareAlike obligations. Historical ready flags never authorize installation. St. Mark's Episcopal Church, Virginian Hotel and Cheyenne Masonic Temple stay quarantined until a corrected exact-file patch is reviewed.

Photo plans update only `image`, `imageAlt`, `imageCredit`, `imageLicense`, and `imageSource`. They cannot change a narrative, timestamp, ID, coordinates or publication state. Assets are decoded and hashed; immutable content-addressed copies stay in the workspace `assets/`, outside Git. Existing approved photos require an explicit replacement review; placeholders can be replaced.

```bash
npm run import:photos -- dry-run --workspace "$PHASM_REVIEW/my-full" \
  --manifest /absolute/reviewed-photo-patch.json --asset-root "$PHASM_INPUT" \
  --crosswalk "$PHASM_INPUT/index/GLOBAL_ID_CROSSWALK.json" \
  --report "$PHASM_REVIEW/photo-dry-run.json"
npm run import:photos -- plan --workspace "$PHASM_REVIEW/my-full" \
  --manifest /absolute/reviewed-photo-patch.json --asset-root "$PHASM_INPUT" \
  --crosswalk "$PHASM_INPUT/index/GLOBAL_ID_CROSSWALK.json"
npm run import:photos -- apply --workspace "$PHASM_REVIEW/my-full" \
  --patch-version YOUR_MANIFEST_PATCH_VERSION
# The same command, or resume, is inert after completion.
npm run import:photos -- resume --workspace "$PHASM_REVIEW/my-full" \
  --patch-version YOUR_MANIFEST_PATCH_VERSION
```

Future recovered images use a new `patchVersion` and stable IDs from the crosswalk. A version cannot be reused for different metadata/bytes. Frozen plans live in `photo-runs/<patchVersion>.json`; multiple versions can share the same workspace. Invalid/deferred records appear explicitly and are not installed. Files copied before an interrupted database batch remain staged safely; resume verifies exact bytes and continues. An existing identical asset is not recopied or retimestamped.

## Local private UI

```bash
npm run build
npx tsx scripts/nationwide-preview.ts setup \
  --workspace "$PHASM_REVIEW/my-full" --preview "$PHASM_REVIEW/my-full-preview" \
  --port 5182 --photo-assets "$PHASM_REVIEW/my-full/assets"
npx tsx scripts/nationwide-preview.ts serve --preview "$PHASM_REVIEW/my-full-preview"
# In another terminal:
npx tsx scripts/nationwide-preview.ts check-browser \
  --preview "$PHASM_REVIEW/my-full-preview" --screenshots "$PHASM_REVIEW/my-ui-checks"
```

Omit `--photo-assets` if no photo patch was applied. Setup creates a new isolated local D1, imports the catalog into empty migrated tables, generates a mode-600 local credential and enables `EDITORIAL_READ_ONLY=true`. It binds loopback and never creates a remote database. Its export is not a live upsert and does not copy member credentials. Open `http://127.0.0.1:5182/admin/review`; use the local `.dev.vars` credential through the password field, never a URL. The browser checker reads that credential without logging it. Identical setup is inert; changed inputs/builds require a new preview directory. The preview is a frozen copy: recreate it under a new path after changing the import workspace.

Draft responses require authorization, are never cached publicly, and are excluded from public search, list, map, detail/guessed routes and sitemap. Tokens live only in component memory and clear on reload/lock. Review cards paginate at 24; the map uses lightweight point data. Unmapped records remain searchable and filterable by state, show “Location not mapped,” and have no directions link. Local URLs are not public share links.

## Rollback and verification

Roll back newest photo patches before their earlier content import:

```bash
npm run import:photos -- rollback --workspace "$PHASM_REVIEW/my-full" \
  --patch-version YOUR_MANIFEST_PATCH_VERSION
npm run import:nationwide -- rollback --workspace "$PHASM_REVIEW/my-full"
```

Rollback is guarded and atomic for database rows. It restores original rowids/source IDs/JSON and removes only this run's audit rows. It refuses to erase edited locations, later photo patches, or new reviews, media, collections, moderation references or other dependencies on imported places. Asset rollback removes only new owned files that still match their hash and are no longer referenced; preexisting assets remain. Repeated rollback is inert. A rolled-back run cannot be reapplied; prepare a fresh workspace for a new proof. After a later photo patch or editor change, replaying an older content plan intentionally reports a conflict instead of replacing that newer work. Resume the relevant photo version, or prepare a new reviewed content plan against a fresh snapshot.

```bash
PHASM_NATIONWIDE_INPUT="$PHASM_INPUT" npm test
npm run import:check
npm run build
```

There is no configured repository lint command. Prettier checks cover changed files. Tests cover adapters/source namespaces, duplicate identities, null/private coordinates, native validation, invalid URLs, immutable inputs, WAL snapshots, batch transactions, exact no-op/resume, concurrent conflicts, rollback/member preservation, photo isolation/assets, private API/SEO visibility and UI behavior. Full-run results and environment-specific preview paths are recorded in the review handoff; source/link fetch failures are distinguished from missing data and image-rights uncertainty.
