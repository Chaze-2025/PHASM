# Phase 1 verification

Verified on 2026-10-08 in the managed Linux development environment. This is an engineering preview; no public deployment was performed.

## Browser verification

`node tests/browser.mjs` passed **16 of 16 checks** against `http://localhost:5173` using Chromium, MapLibre GL JS 6.13.0, a 1440 × 1000 desktop viewport, and a 390 × 844 mobile viewport. The browser retained the environment's outbound proxy and normal TLS certificate verification. Reduced-motion preference was enabled.

Verified behavior:

- Homepage loads real database records and licensed local photographs; keyboard navigation reaches the visible skip link first.
- Homepage search routes to the Atlas and filters to The Stanley Hotel.
- Category, region and tour filters combine correctly; Europe/Castle returns Edinburgh Castle and Bran Castle. An unmatched search displays the empty state and its reset action restores results.
- MapLibre downloads and renders the real OpenFreeMap basemap, markers, numeric clusters, navigation controls and attribution. The final run recorded 139 successful map-service responses and no non-200 map responses.
- The Stanley search moves the map to Estes Park; zooming works; clicking its marker opens the location preview and the preview opens its full profile. A settled screenshot shows local roads and place labels, including Estes Park, Glen Haven and Beaver Point.
- List view opens reusable profiles with history, reported phenomena, sources, visitor links and the clearly closed community section.
- Saving, browser reload persistence and removal work. Collections are explicitly device-local.
- The editorial screen stays locked and rejects an invalid token; no editor controls appear without authorization.
- Mobile navigation, map/list switching and the Stanley profile work at 390px. Tested home, map, list and profile layouts have no document-level horizontal overflow.
- The final run reported no uncaught JavaScript errors.

Automated axe-core scans using WCAG 2 A/AA and WCAG 2.1 AA tags reported **zero violations** on desktop home, map, list, profile and admin login, and mobile home and profile. These scans are a useful baseline, not a complete accessibility audit or proof of assistive-technology compatibility.

The browser review identified and the implementation corrected a MapLibre stylesheet sizing collision that initially made the canvas invisible, missing mobile labels on map/list controls and the saved-places link, and mobile account navigation visibility. Final screenshots were inspected after those fixes and the MapLibre upgrade.

## Backend and build verification

The implementation team also completed eight backend tests and an isolated local Wrangler/D1 integration test covering authenticated creation, private drafts, publication, FTS search, map results, sitemap inclusion, server-rendered profile content and archival. Migration `0002` was verified against the catalog pagination query plan to remove the temporary sorting step. The production build and `wrangler deploy --dry-run` pass. Both `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=high` report zero vulnerabilities after updating MapLibre and overriding the transitive development dependency `sharp` to a patched release. The dry run only validates packaging; it does not deploy or validate live production bindings.

## Reproduce

From the project directory, install dependencies, prepare the local database and start the development server using the README instructions. In another terminal:

```sh
npx playwright install chromium
node tests/browser.mjs
```

The script uses `PHASM_BASE_URL` (default `http://localhost:5173`) and `PHASM_SCREENSHOT_DIR` (default `/workspace/scratch`). It preserves `HTTPS_PROXY` when present, with localhost access kept local. It requires the Chromium dependencies available in the tested environment.

Artifacts from the final run:

- `/workspace/scratch/phasm-desktop.png`
- `/workspace/scratch/phasm-mobile.png`
- `/workspace/scratch/phasm-map.png`
- `/workspace/scratch/phasm-map-mobile.png`
- `/workspace/scratch/phasm-map-preview.png`
- `/workspace/scratch/phasm-profile-mobile.png`
- `/workspace/scratch/phasm-qa-results.json`

## Remaining release checks

- Test on physical iPhone/Safari and Android devices, including touch, browser chrome, orientation changes and low-memory conditions. The mobile check here uses a narrow Chromium viewport.
- Conduct manual keyboard and screen-reader review across all controls and long-form content. Test preferred text scaling, 200% zoom and all relevant contrast states.
- Exercise deliberate offline/tile-provider failure, loss of WebGL, slow networks, storage denial and Cloudflare/D1 quota errors.
- Run a realistic 5,000+ location performance and query-cost benchmark, recording latency, rows read, payload size and mobile memory. The ten-location seed is not a scale benchmark.
- Review Cloudflare deployment settings, editorial credential rotation, abuse controls, caching and actual account quotas before public launch.
- Complete content, location-safety and image-rights review before progressing from ten foundation profiles to the 50-profile release target.

Public community accounts, submissions and media uploads remain closed; this phase does not claim to validate safeguards for an active community service.
