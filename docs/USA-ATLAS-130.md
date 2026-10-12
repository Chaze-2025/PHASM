# USA Haunted Atlas research integration

The October 10, 2026 handoff contributes 130 researched US profiles across all 50 states. The catalog now has 136 records: 126 additions, four updates to the existing US IDs, and six unchanged international profiles. The public Cloudflare catalog was read before integration and exactly matched the ten records at `0e980f203650ddbac2d843e66f47194f80735359`.

## Content and geography

- Existing IDs and URLs for the Stanley Hotel, Eastern State Penitentiary, Winchester Mystery House and Queen Mary are preserved.
- Seventy-five research profiles have no usable public numeric coordinate pair. They use `null` coordinates with `coordinatePrecision: "withheld"`; no guessed or substitute points were added. Search, lists, profiles and saved places include them. The remaining 61 catalog records have map points.
- Original public narratives and claim-source relationships are retained through the conversion, with reviewed changes to remove internal instructions from visitor copy. Private editorial files and unlicensed image candidates remain outside this public repository.
- New locations use a labelled nonphotographic illustration. Existing approved images remain. External accounts are presented as attributed reports, never as PHASM member reviews or ratings.
- A sourced report can be published without inventing historical context. Nonempty history still requires a historical source. The single original HTTP-only official citation is retained; image URLs remain HTTPS or local assets.
- Access and tour values follow the supplied research. An operator offering admission does not establish permission for after-hours investigations. Original review dates remain visible; this integration is not a fresh verification of operating hours.

## Reproduce and review

Keep the original ZIP and extracted research outside the repository. The deterministic converter reads that external directory and records its input checksums with public provenance under `content/research`. Internal editorial registers are not website assets or repository files.

```sh
npm ci
npx tsx scripts/research-import.ts /path/to/extracted/research
npm run import:validate
npm test
npm run build
```

The converter's `--write` option updates the checked-in catalog and provenance after validation. `npm run setup` creates a local database; it does not update existing records or touch Cloudflare.

## Verification — October 12, 2026

- Native validation: 136 unique records; four stable US updates, 126 additions, six unchanged international profiles. Converter regeneration is byte-identical and all 431 source IDs resolve.
- `npm test`: 28 passing tests, including import collision guards, rerun idempotency, review/collection preservation, source identity, public copy mapping, coordinate withholding and optional history.
- Local Wrangler/D1: populated migration preserved 14 table snapshots, including member records and source row IDs; foreign keys, FTS, nullable coordinates and HTTP citations verified.
- Browser verification: 16 existing regression checks and six atlas checks pass, covering desktop/mobile layouts, search/filtering, map navigation, profile content, 136 paginated records, 61 mapped records, and withheld-location handling. Nine WCAG A/AA scans have no violations. Browser emulation is not a physical-device test.
- Production build and the isolated preview deployment dry run pass. The local API catalog exactly matches the checked-in 136 records.

Browser commands: `node tests/browser.mjs` and `node tests/usa-atlas-browser.mjs`, against `npm run dev`. Screenshots and machine-readable results are retained in the working environment under `/workspace/phasm-verification`.

## Existing Cloudflare preview

The target remains `phasm-phase-1-3-preview` and its isolated `phasm-editorial-preview-db` (`fe55176f-43e7-4b79-82c2-02884e4161a0`). The older Phase 1 and Phase 1.1 Workers and database are separate.

This session could read the live catalog but Wrangler reported **not authenticated**. No remote migration, import or deployment was performed. The live URL will retain its original ten records until an authenticated deployment completes.

For an authenticated deployment, first refresh the complete target inventory and take a private recoverable backup of the database, including all ordinary tables, schema, migration records and member data. A naive full D1 export does not support this database's FTS virtual table; follow the existing preview backup guidance. Do not commit backups.

Generate and inspect the guarded update:

```sh
npx tsx scripts/atlas-revision.ts /private/path/usa-130.sql
node deploy/midnight-preview/validate-config.mjs
```

Migration `0003_withheld_coordinates.sql` rebuilds the location table with nullable coordinates, preserves row IDs and source IDs, restores cascading children, and rebuilds FTS. Apply it to the exact editorial preview database. The guarded update checks every existing location and rejects live drift, unexpected rows and duplicates before any data writes. It preserves reviews and other member data, updates the four US records in place, and inserts 126 additions. A second application is idempotent.

Prepare the clean committed branch with `node deploy/midnight-preview/prepare.mjs`, inspect a Wrangler dry run with the explicit preview configuration, apply the reviewed database update, then deploy that same configuration. Keep the data update and compatible Worker deployment together in a maintenance window: old frontend bundles cannot render withheld coordinates. Verify counts, search, pin withholding, sources, images and preview route restrictions afterward. Publishing this repository branch alone does not deploy Cloudflare.
