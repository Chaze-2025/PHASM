# Phase 1.3 visual and browser validation

The final Midnight Séance interface passed **34 local browser checks** against a seeded development Worker at `http://localhost:5175` on October 8, 2026. The existing functional regression suite is unchanged. The Phase 1.3 supplemental suite retains every Phase 1.1 responsive check and adds checks for historical-image provenance and truthful visual presentation.

| Suite                                                       | Result                   | Evidence                                               |
| ----------------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| Backend tests                                               | 8/8 passed               | `npm test`                                             |
| TypeScript and production build                             | Passed                   | `npm run build`                                        |
| Isolated preview configuration and deployment dry run       | Passed                   | Existing preview validation workflow                   |
| Existing browser regression suite                           | 16/16 passed             | [Machine-readable results](local-browser-results.json) |
| Responsive, touch, motion, and photographic-integrity suite | 18/18 passed             | [Machine-readable results](local-mobile-results.json)  |
| Automated axe WCAG A/AA scans                               | 9 scans, zero violations | Included in the two result files                       |
| Uncaught application JavaScript errors                      | None recorded            | Included in the two result files                       |

## What was exercised

The browser checks cover homepage search, real external MapLibre style and vector-tile loading, geographic map panning and zooming, marker previews, map-to-profile navigation, map/list switching, filters and empty results, official visiting and source links, device-local saved places, and the locked local editorial interface.

Responsive checks use 375 × 844, 390 × 844, 430 × 844, 375 × 667, and 844 × 390 viewports, including touch emulation. They verify readable form and profile text, primary 44px touch targets, menu keyboard focus containment, Escape dismissal, scroll restoration after orientation change, reduced motion, no horizontal overflow, selected map-preview bounds, and touch dragging without accidental page scrolling.

The new archival checks verify that the Getty photograph loads, has descriptive alternative text, credits William H. Mumler, links to its museum record and CC0 terms, and visibly identifies the image as historical staged photography rather than verified paranormal evidence or a photograph associated with a PHASM location. The separate Stanley story remains attributed and unverified. The Stanley dossier distinguishes documented history from reported hauntings and labels its modern photograph's cool monochrome presentation. Planned case files and trails remain explicitly marked as planned.

## Visual inspection

[Before-and-after screenshots](screenshots.md) cover the homepage, Haunted Atlas, and Stanley Hotel at 1440 × 1000 and 390 × 844. Every visible image is loaded before capture, and the page and nested scroll containers are returned to their initial positions. The six baseline screenshots come from the unchanged Phase 1.1 HTTPS preview at commit `cf915ba2c39856346ceb087e374f2f371cc327ca`; the after screenshots show the completed Phase 1.3 interface locally. Per-set metadata records capture URLs, dates, geometry, and loaded image counts.

Additional inspected details:

- [Selected Stanley preview on a 375 × 667 viewport](after/map-selected-short-mobile.png).
- [Filters on a 375 × 667 viewport](after/map-filters-short-mobile.png).
- [Historical photograph and visible attribution on mobile](after/historical-photograph-mobile.png).
- [Stanley profile hero on mobile](after/stanley-hero-mobile.png).

The homepage map teaser is a fresh screenshot of the functioning Midnight Séance map with its OpenFreeMap, OpenMapTiles, and OpenStreetMap attribution retained. It is labelled as a preview and links to the interactive map.

## Reproduce

With the local D1 database migrated and seeded and the development server running:

```sh
PHASM_BASE_URL=http://localhost:5175 npm run test:browser
PHASM_BASE_URL=http://localhost:5175 node tests/visual-phase-1-3.mjs
PHASM_BASE_URL=http://localhost:5175 \
PHASM_SCREENSHOT_DIR=docs/phase-1-3/after \
node tests/capture-phase-1-3.mjs
```

For an isolated deployed preview, set `PHASM_BASE_URL` to its HTTPS URL and add `PHASM_PREVIEW_READONLY=1` for `tests/browser.mjs`. That mode checks the preview guard's 404 response for `/admin` and omits the inaccessible local admin-screen accessibility scan.

## Deployment validation

Deployment validation is performed separately against the isolated Cloudflare preview after committing. This document records the completed local verification before deployment; the delivery report records the remote result, with browser and API/security outputs retained in the workspace.

## Limits and preservation

These are automated Chromium viewport and touch simulations plus screenshot inspection; **no physical iPhone or Safari testing was performed**. Automated axe scans do not constitute a complete accessibility audit or assistive-technology review. OpenFreeMap and Google Fonts remain external services.

The application database schema, ten location records, official sources, community submission restrictions, and editorial authorization were preserved. No reviews, accounts, uploads, Phase 2 content expansion, production launch, or merge into `main` are part of this visual phase. The archived historical photograph is a separately documented cultural artifact and is not added to the location catalog.
