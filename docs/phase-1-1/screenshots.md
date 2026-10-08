# Phase 1.1 visual comparison

Before screenshots show the unchanged Phase 1 Cloudflare preview at commit `9da8948`. After screenshots show the Phase 1.1 application running locally from the final development branch before deployment. Capture metadata is recorded beside each set.

Both sets use Chromium at 1440 × 1000 (desktop) and 390 × 844 (mobile), with reduced motion enabled. Full-page screenshots preserve the complete page, including image attribution. The mobile captures are viewport simulations, not physical iPhone testing.

| Screen        | Desktop before                             | Desktop after                            | Mobile before                             | Mobile after                            |
| ------------- | ------------------------------------------ | ---------------------------------------- | ----------------------------------------- | --------------------------------------- |
| Homepage      | [Before](before/homepage-desktop.png)      | [After](after/homepage-desktop.png)      | [Before](before/homepage-mobile.png)      | [After](after/homepage-mobile.png)      |
| Haunted Atlas | [Before](before/map-desktop.png)           | [After](after/map-desktop.png)           | [Before](before/map-mobile.png)           | [After](after/map-mobile.png)           |
| Stanley Hotel | [Before](before/stanley-hotel-desktop.png) | [After](after/stanley-hotel-desktop.png) | [Before](before/stanley-hotel-mobile.png) | [After](after/stanley-hotel-mobile.png) |

## Local browser results

- Existing browser regression suite: **16/16 checks passed**, including seven automated axe WCAG A/AA scans with zero violations.
- Supplemental responsive and touch suite: **17/17 checks passed**, including two additional automated axe scans with zero violations.
- Supplemental viewports: 375 × 844, 390 × 844, 430 × 844, 375 × 667, and 844 × 390 after menu orientation change.
- Verified map touches, marker previews, filters, map/list switching, profile links, loaded images, form font sizes, primary touch targets, reduced motion, page overflow, menu focus containment, Escape and scroll-lock restoration.
- No uncaught application JavaScript errors were recorded.

Machine-readable results: [existing suite](local-browser-results.json) and [responsive suite](local-mobile-results.json).

To reproduce against a seeded development server:

```sh
PHASM_BASE_URL=http://localhost:5174 npm run test:browser
PHASM_BASE_URL=http://localhost:5174 node tests/visual-phase-1-1.mjs
```

For the isolated deployed preview, set `PHASM_BASE_URL` to its HTTPS URL and `PHASM_PREVIEW_READONLY=1` for the existing browser suite. The latter expects the preview guard to return 404 for `/admin`; local testing retains the original locked editorial-screen check.

Automated checks are not a complete accessibility audit. Physical iPhone/Safari testing, assistive-technology review and actual mobile browser chrome behavior remain useful follow-up checks.
