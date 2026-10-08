# Editorial voice and charcoal atlas: verification

The revision keeps PHASM’s green-and-brass identity, clear photography, homepage mist, navigation and discovery features. The copy now leads with ghost stories and place, while the location dossiers keep reported hauntings, history, source references and visiting information clearly organized.

## Visual comparison

Baseline: the published `8ffeb28` preview, captured before deployment. The after images use the new development branch. These captures use reduced motion so the same still layouts can be compared; the fog renderer itself is unchanged.

| Page          | Desktop before                                       | Desktop after                                      | Mobile before                                       | Mobile after                                      |
| ------------- | ---------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| Homepage      | [Before](artifacts/before/homepage-desktop.png)      | [After](artifacts/after/homepage-desktop.png)      | [Before](artifacts/before/homepage-mobile.png)      | [After](artifacts/after/homepage-mobile.png)      |
| Haunted Atlas | [Before](artifacts/before/map-desktop.png)           | [After](artifacts/after/map-desktop.png)           | [Before](artifacts/before/map-mobile.png)           | [After](artifacts/after/map-mobile.png)           |
| Stanley Hotel | [Before](artifacts/before/stanley-hotel-desktop.png) | [After](artifacts/after/stanley-hotel-desktop.png) | [Before](artifacts/before/stanley-hotel-mobile.png) | [After](artifacts/after/stanley-hotel-mobile.png) |

## Results

The production build and **10 backend/data-preservation tests passed**.

- [Homepage mist regression](artifacts/fog-regression.json): **18/18 passed**, including protected-content pixel comparisons, reduced motion and responsive layout checks.
- [Core browser suite](artifacts/core-browser-report.json): **16/16 passed**.
- [Supplemental mobile suite](artifacts/mobile-browser-report.json): **18/18 passed**.
- [WebKit mobile checks](artifacts/webkit-report.json): **5/5 passed**, including real map tile loading confirmed in the [network record](artifacts/webkit-map-network.json).
- [Catalogue and no-JavaScript profile audit](artifacts/catalog-ssr-audit.json): **14/14 passed**, covering all ten existing locations and both archival photographs.
- **Eleven axe scans, zero violations**; no uncaught browser exceptions.
- All captured pages fit the tested viewport without horizontal scrolling. Tests include narrow 375-pixel screens, 390- and 430-pixel layouts, touch interactions, landscape resizing and the short 375×667 map view.

The updated layout baseline records one intentional copy-wrap change: at 390 pixels, the homepage atlas section is 838.421875 pixels high rather than 867.1875. All other measured component geometry is unchanged; the historical fog-phase baseline remains intact.

The rendered homepage, charcoal atlas and Stanley dossier were visually inspected on desktop and mobile. The actual map screenshot contains neutral near-black land (`#0c0c0c`) and charcoal water (`#1b1b1d`), with readable place labels and distinct brass/ivory markers. The site's surrounding dark green palette remains intact. The Stanley profile presents **The Story → The Hauntings → The History**, with source references and visiting links retained. Images remain clear, and the longer narrative text wraps comfortably on mobile.

The audit found no new records, phenomenon tags, reviews, eyewitness accounts or active submission forms. All four community write routes returned 403 locally. Archival caption revisions leave the museum provenance, licensing, rights and internal integrity metadata unchanged.

## Scope of checks

The existing browser suites retain their functional and accessibility coverage. Only assertions tied to intentionally revised copy changed: the profile headings, attributed Stanley lore, and the concise explanation of historical staged photography. Tests still require the Getty source, CC0 license, Mumler credit, staged superimposition context, separation from atlas-location photographs, clear planned-feature labels, real image loading and accessible text alternatives.

The core suite covers homepage search, live map tiles, filters, empty states, list and map views, marker previews, zooming, location profiles, sources, official links, local saved places, the locked editorial interface, mobile navigation and axe scans. The supplemental suite covers 375-, 390- and 430-pixel widths, form sizes, touch targets, reading widths, reduced motion, marker selection, map touch-drag without page scrolling, focus management, menu resize behavior and the short 375×667 map preview.

The catalogue/SSR audit checks all ten existing records. Identity, coordinates, taxonomy, access, official links, media, publication state and dates remain unchanged. Sources retain their titles, kinds and counts; only the two verified broken URLs documented in the [source review](SOURCE-REVIEW.md) change. Each API record must match the revised copy, and its complete no-JavaScript profile must retain the same narrative, sources, official links and structured metadata. Community submission, review, suggestion and upload routes remain closed.

## Reproduce

With the updated local seed and development server on port 5177:

```sh
PHASM_BASE_URL=http://localhost:5177 PHASM_SCREENSHOT_DIR=/tmp/phasm-editorial-core node tests/browser.mjs
PHASM_BASE_URL=http://localhost:5177 PHASM_SCREENSHOT_DIR=/tmp/phasm-editorial-mobile node tests/visual-phase-1-3.mjs
```

## Remaining review limits

The browser checks use Chromium and Linux WebKit with mobile viewport and touch emulation, not a physical iPhone. Source verification limitations are recorded in [SOURCE-REVIEW.md](SOURCE-REVIEW.md), including two Visit Pendle pages that were inaccessible from the workspace; the existing trail PDF was readable. Public community submissions remain intentionally unavailable.
