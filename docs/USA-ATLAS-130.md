# USA Haunted Atlas research integration

The October 10, 2026 handoff contributes 130 researched US profiles across all 50 states. The catalog has 136 records: 126 additions, four updates to the existing US IDs, and six unchanged international profiles. The public Cloudflare catalog was read before integration and exactly matched the ten records at `0e980f203650ddbac2d843e66f47194f80735359`.

The atlas and subsequent coordinate update are **deployed and verified**: all 136 profiles have live map points, including 75 newly researched approximate references and the 61 preserved original points. Both deployments and their verification are recorded below.

## Content and geography

- Existing IDs and URLs for the Stanley Hotel, Eastern State Penitentiary, Winchester Mystery House and Queen Mary are preserved.
- The original handoff omitted usable coordinate pairs for 75 profiles. At the user's request, subsequent research supplied a sourced map point for every one of them. All 136 profiles are now mapped in the checked-in catalog, with the original 61 mapped records preserved unchanged.
- All 75 additions use `coordinatePrecision: "approximate"`. They reference an inspected building, property, marker, park, road segment or other named feature; they do not assert a surveyed visitor entrance. Numeric values come from inspected public sources or explicit address-geocoder responses, without invented town-centroid substitutes or forced decimal rounding. Private ownership and other access restrictions remain in force.
- Original public narratives and claim-source relationships are retained through the conversion, with reviewed changes to remove internal instructions from visitor copy. Private editorial files and unlicensed image candidates remain outside this public repository.
- New locations use a labelled nonphotographic illustration. Existing approved images remain. External accounts are presented as attributed reports, never as PHASM member reviews or ratings.
- A sourced report can be published without inventing historical context. Nonempty history still requires a historical source. The single original HTTP-only official citation is retained; image URLs remain HTTPS or local assets.
- Access and tour values follow the supplied research. An operator offering admission does not establish permission for after-hours investigations. Original review dates remain visible; this integration is not a fresh verification of operating hours.

## Coordinate evidence

[`content/research/usa-130-geocodes.json`](../content/research/usa-130-geocodes.json) contains the 75 reviewed coordinate records, keyed by stable research ID. Each entry supplies latitude, longitude, approximate precision, point kind, source URL/title, supporting evidence and the October 12 inspection date. Evidence distinguishes the named historical site from similarly named places and replacement institutions. For example, the Old Montana Prison point identifies the museum in Deer Lodge rather than the newer operational prison west of town.

Sources include published Wikipedia coordinates, official visitor maps and geographic records, historical-marker and archival collections, and U.S. Census address-geocoder responses where the named property's published address was matched. The evidence records the inspected numeric pair and any interpretation needed for a marker, road or area reference. These are map references, not new historical or paranormal claims.

The converter records the coordinate registry's SHA-256 digest and per-location geographic provenance in `usa-130-provenance.json`. The public bibliography, `usa-130-sources.json`, retains **431 original source records plus 75 geographic references: 506 records in total**. Geographic references are separate from narrative source roles, and coordinate inspection dates do not replace the original story or visitor-information review dates.

## Reproduce and review

Keep the original ZIP and extracted research outside the repository. The deterministic converter reads that external directory and records its input checksums with public provenance under `content/research`. Internal editorial registers are not website assets or repository files.

```sh
npm ci
npx tsx scripts/research-import.ts /path/to/extracted/research
npm run import:validate
npm test
npm run build
```

The converter automatically reads the reviewed coordinate registry when present. Its `--write` option updates the checked-in catalog, provenance and public bibliography after validation. It preserves the 55 original US research points and the six international profiles while adding the 75 researched points. `npm run setup` creates a local database; it does not update existing records or touch Cloudflare.

## Initial import verification — October 12, 2026

These results describe source `9d76541aec32d093a2caa2f3d2a617d73ebe22f3`, which first deployed the expanded atlas with 61 mapped records and 75 withheld coordinates. They are historical results, not a claim that the subsequent coordinate update has passed the same checks.

- Native validation: 136 unique records; four stable US updates, 126 additions, six unchanged international profiles. Converter regeneration was byte-identical and all 431 original source IDs resolved.
- `npm test`: 28 passing tests, including import collision guards, rerun idempotency, review/collection preservation, source identity, public copy mapping, coordinate withholding and optional history.
- Local Wrangler/D1: populated migration preserved 14 table snapshots, including member records and source row IDs; foreign keys, FTS, nullable coordinates and HTTP citations verified.
- Browser verification: 16 existing regression checks and six atlas checks pass, covering desktop/mobile layouts, search/filtering, map navigation, profile content, 136 paginated records, 61 mapped records, and withheld-location handling. Nine WCAG A/AA scans have no violations. Browser emulation is not a physical-device test.
- Production build and the isolated preview deployment dry run passed. The local API catalog exactly matched the initial 136-record snapshot.

Browser commands: `node tests/browser.mjs` and `node tests/usa-atlas-browser.mjs`, against `npm run dev`. Screenshots and machine-readable results are retained in the working environment under `/workspace/phasm-verification`.

## Coordinate update verification — October 12, 2026

- All 35 automated tests pass, including source evidence validation, preservation of existing mapped profiles and member data, guarded drift rejection, and idempotent coordinate revisions.
- Deterministic regeneration, native validation of 136 published profiles, TypeScript, production build and the explicit preview dry run pass. The bibliography preserves 431 original references and adds 75 geographic references.
- The real local D1 revision and its rerun passed: 136 mapped profiles, zero withheld profiles, exactly 75 coordinate audit entries, clean foreign keys and integrity checks.
- Local browser verification passed six USA checks plus two actual Woodburn marker interactions at desktop and mobile widths, with no runtime or accessibility failures. Approximate private-site markers open their matching profiles and retain visitor restrictions.
- Before the live update, all 19 ordinary tables, schema, rowids and autoincrement sequences were backed up privately with a Time Travel bookmark. A generated restore script reproduced the full snapshot exactly, including FTS, foreign keys and integrity. The ordinary D1 export alone can renumber implicit rowids; use the separately verified rowid-preserving restore artifact.
- After deployment, all 136 live database profiles and map points exactly matched the committed catalog. All 61 previously mapped profiles, 17 other tables, original location rowids and prior audits were unchanged. Exactly 75 new coordinate audit entries were appended; remote foreign-key and integrity checks pass.
- Live browser verification passed 23 checks: 15 core regressions, six USA atlas checks and two actual Woodburn marker interactions. Eight WCAG A/AA scans reported zero violations; no application errors occurred. Desktop/mobile coverage uses browser emulation rather than physical devices.

Coordinate verification artifacts are retained privately under `/workspace/phasm-verification-geocodes` and `/workspace/phasm-cloudflare-backup-geocodes-2026-10-12`.

## Existing Cloudflare preview

The target remains `phasm-phase-1-3-preview` and its isolated `phasm-editorial-preview-db` (`fe55176f-43e7-4b79-82c2-02884e4161a0`). The older Phase 1 and Phase 1.1 Workers and database are separate.

The initial import deployed on **October 12, 2026** to [the existing Cloudflare preview](https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev). Its source was `9d76541aec32d093a2caa2f3d2a617d73ebe22f3`; Worker version `e0a7fbbf-65f2-4f40-b979-092da09907c9`. At verification, the live API exactly matched that snapshot's 136 records: 130 US profiles across all 50 states, 61 map points and 75 withheld pins. The import appended 130 atlas audit entries, and remote foreign-key and integrity checks passed.

Before deployment, all 19 ordinary tables, schema and rowids were backed up privately and a Time Travel bookmark was saved. A local restore verified the table counts, rowids, original catalog, foreign keys and rebuilt FTS. Migration 0003 preserved all 18 existing data tables byte-for-byte before the catalog update. The compatible Worker was deployed before importing withheld-coordinate records.

The coordinate update deployed on **October 12, 2026** from source `69b6c4b3fd048ef9254d91373e610de52ef0004f`, Worker version `8538cdf2-47b7-4305-a697-4a98227e85d8`. The live preview now has **136 map points and zero withheld pins**. The initial version remains the pre-coordinate recovery baseline.

## Apply the coordinate update

First refresh the complete target inventory and take a private recoverable backup of the database, including all ordinary tables, schema, migration records and member data. A naive full D1 export does not support this database's FTS virtual table; follow the existing preview backup guidance and retain a Time Travel bookmark. Do not commit backups.

Generate and inspect the dedicated guarded update for the already imported atlas:

```sh
npx tsx scripts/geocode-revision.ts /private/path/geocodes.sql
node deploy/midnight-preview/validate-config.mjs
```

The generator uses `9d76541aec32d093a2caa2f3d2a617d73ebe22f3` as its baseline. It requires the 136 existing records, protects all fields of the 61 already mapped records, and allows coordinate fields plus one exact reviewed Devil's Tramping Ground access-notice replacement to change. Source relationships, narrative copy, access classifications, images, IDs and slugs remain protected. Shared guards compare live JSON, indexed columns, sources and tags before any writes; unexpected drift stops the update. The update preserves member data and appends `mapped:usa-atlas-75:2026-10-12` audit entries. An already-applied revision is accepted without duplicate audit entries. Generating SQL changes no database.

The initial import already applied migration `0003_withheld_coordinates.sql`, which preserved row IDs, source IDs and cascading children while rebuilding FTS. The coordinate update needs no additional schema migration. `scripts/atlas-revision.ts` remains the original ten-to-136 import generator; use the dedicated geocode revision for this deployed baseline.

Prepare the clean committed branch with `node deploy/midnight-preview/prepare.mjs` and inspect a Wrangler dry run with the explicit preview configuration. Deploy the compatible Worker/frontend and apply the reviewed coordinate update only to the isolated editorial preview database. Verify the complete API catalog against the committed data, 136 total map points, zero withheld pins, unchanged original 61 profiles, preserved relationships, geographic source provenance, private-access wording, images and preview route restrictions. Record the actual source commit, Worker version and verification results after deployment. Publishing the repository branch alone does not deploy Cloudflare.
