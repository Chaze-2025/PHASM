# Nationwide preview review — October 12, 2026

Implementation branch: `codex/nationwide-research-2853`, based on `ad5bdec0da6a0fb28daa09968121459fdae39cce`. No push, merge, production deployment or live application-data write was performed. The local preview is ready for owner review; it does not authorize publication.

## Reconciled catalog

| Measure                                                     |        Result |
| ----------------------------------------------------------- | ------------: |
| Indexed U.S. research records / states                      |    2,853 / 50 |
| Existing U.S. records preserved by content import           |           130 |
| New draft records                                           |         2,723 |
| Preserved international records                             |             6 |
| Combined local catalog                                      |         2,859 |
| Published records (existing only)                           |           136 |
| Content updates / rejected / conflicted / unexplained drops | 0 / 0 / 0 / 0 |
| Existing mapped points / new approximate points             |      136 / 31 |
| Mapped total / explicitly unmapped records                  |   167 / 2,692 |
| Supplied photos installed / registered photo missing        |        33 / 1 |
| Existing real photos retained / total real photos           |        5 / 38 |
| Nonphotographic illustrations                               |         2,821 |

The separate photo patch replaces two existing **placeholders** (Willard Library and Point Lookout State Park), plus 31 new-draft placeholders. Previously approved photographs are unchanged. IDs, slugs, narratives, relationships, source IDs, publication states, existing coordinates and all six international profiles remain intact.

The input's 73 numeric pairs are 41 overlapping baseline records and 32 proposed additions. Cry Baby Hollow's one explicit `withheld_pending_access_and_geocode_check` point remains withheld; the other 31 new site/parking reference points are preserved as approximate. No city-center/random/zero pins were invented. A USDA source spot-check returned 403; its recorded visitor-parking evidence remains in the sidecar and is distinguished from newly fetched verification.

## Repeatability evidence

- Pilot: deterministic 25profiles, 18 draft additions, 154 combined records. Deliberately stopped after 10 operations and resumed. Identical rerun preserved the entire SQLite file hash.
- Full content run: deliberately stopped after 300 operations, then resumed all 2,853 in 100-record transactions. Repeating the completed plan preserved SQLite SHA-256 `f40426fd0ad9e9ed16a0d06b3c679556c8597e18deaac8cc3d317c144965dcef` exactly.
- Photo version `nationwide-photos-2026-10-12-v2`: stopped after 10 of 33 operations, resumed, then reran. Database SHA-256 `9275e7c6aca090071d4c4fe0fdc005f229608f89e7dbca3e1673d90c65add09e`, every asset hash, and every asset modification time remained identical.
- Rollback tested on separate pilot and full copies. All 19 original application tables and original location rowids were restored exactly. The full rollback removed only 33 newly owned, unreferenced assets. The working preview was retained.
- Tests reject concurrent native/relational edits, changed inputs/version/checkpoints, unsafe paths, corrupt assets, narrative changes inside photo patches, and rollback that would erase later contributions.

Content adapter version: `1.0.1`. Content/manifest fingerprint: `a21736313a51b784bc18f38ad63db993e0758ebdd8d49ecddda149dd0b77ef90`. Full content run ID: `ed30923ea34deebe4cfd40ebd635dcfbd3940a7feecadc4a9f7d9241c7996002`. Photo manifest hash: `b3e9e4cccf626bb4f5e1244b554fce43ee1cb06c3a5adc31febf84fe3d53c6ba`.

## Verification and preview

- `PHASM_NATIONWIDE_INPUT=... npm test`:161 tests pass,0 failed,0 skipped.
- `npm run import:check` and `npm run build` pass. Changed-file Prettier and `git diff --check` pass; the repository has no configured lint script.
- Strict input verification:661 present checksum entries pass,2,853 original pointers resolve, all 50 state counts and 130 baseline identities reconcile. The unchanged bundled verifier reports solely the absent Montana State Prison Museum image; a full 34-image bundle pass is not claimed.
- All 33 received images were decoded, matched against exact source originals, checked for file-specific rights/creator/attribution and visually compared. The two photo ZIP archives themselves were never received. Registered image hashes match the individually supplied files.
- All 12 desktop/mobile private review browser checks pass and cover authorization, public draft exclusion, pagination, state/search filters, maps, empty results, image fallback/credits/license versions, a whole Belvoir panorama, and private approximate/unmapped access cautions. Axe scans report no violations. All 40 unique local image paths return 200; all 33 research image responses match their content-addressed SHA-256.
- All 16 public home/map/list/profile browser regression checks pass and cover navigation, search, filters, saves, markers, mobile layout and accessibility. A fast-filter interaction that could erase unsubmitted search text was corrected and covered by the browser flow.

Final preview: `http://127.0.0.1:5184/admin/review` (workspace loopback only). Preview directory: `/workspace/phasm-nationwide-review/full-preview-final`. Its random credential stays in its mode 600 `.dev.vars` file, outside Git/reports; the review holds credentials in memory and is read-only. It can be restarted with:

```bash
npx tsx scripts/nationwide-preview.ts serve --preview /workspace/phasm-nationwide-review/full-preview-final
```

Full-scale local measurements use ten sequential loopback reads per endpoint, not a production/mobile benchmark. Draft lists page 24 are about 23 KB and all 167 private map points about 42.8 KB; points contain no narratives. Final p95 is 12.78 ms for the first draft page, 13.50 ms for page 50, 10.93 ms for filtered Colorado hotel search, 20.35 ms for all 167 private points, and 14.11 ms for 136 public points. The frozen preview's `screenshots/review-api-performance.json` records all samples and payloads. Existing pagination, indexes, cache boundaries and clustering were reused; no app database migration was added.

## Review artifacts and remaining decisions

Private artifacts remain under `/workspace/phasm-nationwide-review`: recoverable `preflight/`, immutable `input/`, full per-record `full/reports/records.json`, crosswalk and readable report, native catalogs, content/photo journals and rerun proofs, rollback proofs, all source/media evidence, versioned photo manifests, browser screenshots and test/build logs. Raw data and bulk reports are excluded from the implementation commit.

Remaining editorial/media issues:

- The Old Montana Prison/Montana State Prison Museum image was not supplied; the profile stays available with an honest placeholder.
- Wyoming St. Mark's Episcopal Church, Virginian Hotel and Cheyenne Masonic Temple retain their records but their inherited image choices remain quarantined.
- Springfield–Des Arc Bridge has no verified locality; it stays empty/unmapped. Green Mount Cemetery–Black Agnes has a supplemental source-role conflict retained for review; its existing published content is unchanged.
- Hiwan/Lace locality alternatives and the Pueblo image-subject distinction remain explicit review notes. Mechanically complete content is not editorial approval; all 2,723 proposed additions remain drafts.
- No claim is made that all 3,724 source URLs were newly fetched. Exact installed-photo sources were checked; research provenance and sampled external failures are preserved separately.

The owner's next decision is whether to approve this implementation and the reviewed draft import for the next live-integration step. Publication choices for the 2,723 drafts require an explicit decision; nothing in this review publishes them. Exact repeatable commands are in [NATIONWIDE-IMPORT.md](NATIONWIDE-IMPORT.md); later image patches are documented in [NATIONWIDE-MEDIA-REVIEW.md](NATIONWIDE-MEDIA-REVIEW.md).
