# Midnight Séance visual comparison

Before screenshots show the unchanged Phase 1.1 Cloudflare preview at commit `cf915ba2c39856346ceb087e374f2f371cc327ca`. Each screenshot set has a `capture.json` recording its source URL, date, viewport, and image-loading checks.

The desktop viewport is 1440 × 1000; mobile is 390 × 844 with touch emulation. Both use Chromium with reduced motion enabled. Full-page screenshots include source and attribution details. These are browser simulations, not physical iPhone or Safari tests.

| Screen        | Desktop before                             | Desktop after                            | Mobile before                             | Mobile after                            |
| ------------- | ------------------------------------------ | ---------------------------------------- | ----------------------------------------- | --------------------------------------- |
| Homepage      | [Before](before/homepage-desktop.png)      | [After](after/homepage-desktop.png)      | [Before](before/homepage-mobile.png)      | [After](after/homepage-mobile.png)      |
| Haunted Atlas | [Before](before/map-desktop.png)           | [After](after/map-desktop.png)           | [Before](before/map-mobile.png)           | [After](after/map-mobile.png)           |
| Stanley Hotel | [Before](before/stanley-hotel-desktop.png) | [After](after/stanley-hotel-desktop.png) | [Before](before/stanley-hotel-mobile.png) | [After](after/stanley-hotel-mobile.png) |

Capture a seeded running application:

```sh
PHASM_BASE_URL=http://localhost:5175 \
PHASM_SCREENSHOT_DIR=docs/phase-1-3/after \
node tests/capture-phase-1-3.mjs
```

The capture command scrolls each visible image into view and waits for it to load before returning to the top and saving the screenshot.

The after set shows the completed Phase 1.3 interface running locally after its final stylesheet updates. All 34 browser checks and nine automated accessibility scans passed; see [test results and limits](TEST-RESULTS.md).

Further mobile details: [selected map preview](after/map-selected-short-mobile.png), [filters](after/map-filters-short-mobile.png), [historical photograph](after/historical-photograph-mobile.png), and [Stanley hero](after/stanley-hero-mobile.png).
