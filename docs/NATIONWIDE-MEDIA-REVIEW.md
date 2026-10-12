# Nationwide photo review and repeatable patches

The content import and photo import are separate. Research `publishable_verified` and `rights_verified_visual_pending` labels do not authorize installation. The photo planner requires an independently completed review of the exact file, its source-page license, and its visible subject. New content can remain a draft with the existing, explicitly nonphotographic PHASM atlas placeholder.

## Review evidence, October 12, 2026

The package registers 34 actual image assets. The user supplied 33 individual files, each matching the package's SHA-256; all 33 decode and were visually inspected. The missing file is the Old Montana Prison / Montana State Prison Museum photograph. No photo ZIP archive was received or represented as verified.

The final independently reviewed patch clears all 33 received files. Version 1 preserves the first 19 reviews; version 2 adds 14 and retains the original 19 unchanged. For each, the review retains the supplied-file SHA-256, exact original asset URL and downloaded-file SHA-256, source HTML SHA-256, creator, file-specific license, attribution, subject description, review date, transformation disclosure, and ShareAlike obligations. The supplied file was compared visually with its exact-source original, including orientation-corrected side-by-side contact sheets. A similar photograph or a site's footer license does not clear the selected file.

The initial 12 HTTP 429 responses were resolved after honoring the 600-second retry interval. Two originals exceeded the initial, self-imposed 25 MiB audit cap; both were then safely streamed with a 100 MiB cap (approximately 29 MiB each). All 33 exact originals now download successfully and have matching visible compositions and verified file-specific rights. No download blocker remains for the received assets. The single missing Old Montana Prison photo remains an explicit omission. New clearance was issued as version 2; version 1 remains immutable.

The following research image choices remain quarantined until a corrected exact-file patch clears them, regardless of inherited labels:

- `phasm-us-wy-st-marks-episcopal-church`
- `phasm-us-wy-virginian-hotel`
- `phasm-us-wy-cheyenne-masonic-temple`

Their location records are retained. A Library of Congress “no known restrictions” advisory alone is not treated as a cleared license. Pueblo Hose Company No. 3 must not inherit a photograph of the separate Main Street center. No uncertain research URL is hotlinked by the importer.

Bulk evidence remains outside Git at `/workspace/phasm-nationwide-review/media/`: `audit-summary.json`, `source-audit.json`, `evidence/`, contact sheets, and versioned review manifests. `reviewed-photo-patch-v1.json` preserves the exact first frozen manifest; `reviewed-photo-patch-v2.json` is the complete 33-file review manifest. Source HTML and original assets are evidence, not instructions or public app data.

## What a photo patch may change

`scripts/nationwide-media.ts` resolves `research_id` through the same crosswalk as the content importer: `preserve_app_id || canonical_site_id`. It only changes `image`, `imageAlt`, `imageCredit`, `imageLicense`, and `imageSource`. It preserves IDs, slugs, narratives, timestamps, coordinates, source relationships, publication status, and member contributions. An existing approved image is retained unless its replacement is explicitly reviewed.

Photo patches use their own version and manifest hash. Each target has before/after image hashes and a rollback snapshot. Identical inputs applied again make no content, timestamp, asset, or ordering changes. Concurrent image edits cause conflicts. `applyMediaFields` can apply to the current record without replacing newer narrative edits; the storage transaction additionally checks its complete frozen preflight state.

The planner is read-only and decodes each candidate with Sharp. It accepts static JPEG, PNG, WebP, and AVIF, rejects corrupt or animated images, limits decoding to 80 million pixels, validates asset SHA-256, and rejects traversal/symlink escapes. Installed paths are content-addressed: `images/research/<sha256>.<decoded-format>`. The asset journal records whether each file already existed so rollback can preserve shared or pre-existing files and remove only unused assets introduced by this patch.

## Attribution and display

CC BY and CC BY-SA credits name the creator, link the exact license version, and disclose resizing/recompression or display crops. ShareAlike adaptations must retain the same or a compatible license. The app's license helper links the appropriate CC BY/CC BY-SA version or CC0 1.0, rather than assuming CC BY-SA 4.0.

Public-domain releases must state their basis. Hampton's exact file has James G. Howes's explicit attribution-only grant allowing redistribution, derivatives, and commercial use; its source page contains the grant. Custom grants and public-domain declarations link to the exact source page. Credits and license links remain visible in detail/review UI. Images of site details (such as Antietam's interpretive panel) use descriptive alt text rather than claiming to be building exteriors. The original supplied bytes remain immutable; responsive display may crop, as disclosed. The very wide Belvoir Winery panorama retains its full frame rather than cropping into an apparent close building view. Sharp decodes and the app’s panorama handling are separate from the source-identity and rights review.

## Repeatable commands

Use an initialized isolated workspace from the main nationwide README. These commands do not target live D1 or publish anything. Substitute an actual workspace path; `$PHASM_INPUT` points to the extracted handoff root and `$PHASM_REVIEW` to a reviewed, versioned manifest.

```bash
export PHASM_INPUT=/workspace/phasm-nationwide-review/input/PHASM_50_State_Research_Handoff_2853_2026-10-12
export PHASM_REVIEW=/workspace/phasm-nationwide-review/media/reviewed-photo-patch-v2.json
export PHASM_PREVIEW=/workspace/phasm-nationwide-review/full

# Read-only validation and diff. No command defaults to applying.
npm run import:photos -- dry-run --workspace "$PHASM_PREVIEW" --manifest "$PHASM_REVIEW" --asset-root "$PHASM_INPUT" --crosswalk "$PHASM_INPUT/index/GLOBAL_ID_CROSSWALK.json"

# Freeze an independently resumable, versioned plan.
npm run import:photos -- plan --workspace "$PHASM_PREVIEW" --manifest "$PHASM_REVIEW" --asset-root "$PHASM_INPUT" --crosswalk "$PHASM_INPUT/index/GLOBAL_ID_CROSSWALK.json"

# Demonstrate one resumable batch, then complete it.
npm run import:photos -- apply --workspace "$PHASM_PREVIEW" --patch-version nationwide-photos-2026-10-12-v2 --batch-size 5 --max-batches 1
npm run import:photos -- resume --workspace "$PHASM_PREVIEW" --patch-version nationwide-photos-2026-10-12-v2 --batch-size 5

# A repeat is a no-op. Undo only this patch when reviewing rollback.
npm run import:photos -- resume --workspace "$PHASM_PREVIEW" --patch-version nationwide-photos-2026-10-12-v2
npm run import:photos -- rollback --workspace "$PHASM_PREVIEW" --patch-version nationwide-photos-2026-10-12-v2
```

Later recovered photos can use a separate asset directory with the same crosswalk. Give every changed manifest a new `patchVersion`. Preserve old manifests and evidence for reproducibility. A compact single-review manifest has this shape; replace example hashes and assertions with actual checked evidence before planning:

```json
{
  "patchVersion": "recovered-photos-2026-10-20-v1",
  "reviews": [
    {
      "researchId": "phasm-us-example-stable-id",
      "assetPath": "photos/site.jpg",
      "sha256": "<64 lowercase hexadecimal characters>",
      "sourcePage": "https://example.org/exact-file-page",
      "originalAssetUrl": "https://example.org/exact-file.jpg",
      "originalAssetSha256": "<hash of downloaded exact original>",
      "sourceEvidenceSha256": "<hash of retained exact source-page evidence>",
      "creator": "Named photographer",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "attribution": "Named photographer / CC BY-SA 4.0; resized; display may crop",
      "reviewedAt": "2026-10-20",
      "reviewer": "Reviewer identity",
      "subjectDescription": "Description of the actual named site and visible view",
      "exactFileEvidence": "How this file was matched to the source-page original",
      "rightsEvidence": "File-specific licensing statement and evidence",
      "transformations": "Describe any resizing, cropping or other changes",
      "shareAlike": "Adaptations retain the same or a compatible license",
      "exactFileVerified": true,
      "visualSubjectVerified": true,
      "rightsVerified": true
    }
  ]
}
```

`replaceExisting: true` requires an intentional reviewed replacement. For the three explicitly quarantined choices, `correctedQuarantinedChoice: true` additionally records that the replacement, rather than the mismatched inherited choice, has been checked.

## Regression checks

```bash
npx tsx --test tests/nationwide-media.test.ts
```

The 15 focused tests cover stable identity mapping, image-only isolation, unchanged timestamps, no-op reruns, independent rollback, concurrent image/narrative edits, preservation of existing photos, absent rights/visual proof, incorrect license-version links, Wyoming quarantines, corrupt decodes/hash mismatches, unsafe paths, duplicate targets, and later PNG/WebP/AVIF patches. The importer/store suite separately exercises atomic batches, interrupted resume, asset receipts, and rollback against isolated storage.
