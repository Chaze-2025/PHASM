# PHASM responsiveness

The performance update preserves the complete 136-location catalog, coordinates,
profile content, visual design, and rolling-fog shader.

## Map

- Fetch the complete unaggregated point feed once per filter and cluster locally.
  Panning, zooming, resizing, and list pagination reuse these points.
- Fit the camera once per completed filter, using every matching point rather
  than the current page of cards. Ignore superseded requests and cluster clicks.
- Retain a bounded viewport-query fallback when the catalog exceeds 500 points.
  Repeated bounds do not repeat requests; antimeridian bounds remain supported.
- Use MapLibre's built-in resize observer and cap canvas density at DPR 2.
- Load MapLibre only on the first map view. List-only visits avoid its JavaScript,
  CSS, worker and WebGL context; switching views retains the existing map.

## Loading and data

- Optional `format=summary` responses contain card fields; default API responses
  still include full profiles. Atlas cards, marker previews, homepage cards and
  saved cards use the lighter format.
- Anonymous public requests share in-flight work with independent cancellation.
  Successful cacheable responses have a 30-second maximum lifetime in a 64-entry
  in-memory LRU. Errors, private/admin/authenticated requests and explicit fetch
  overrides bypass reuse. Successful mutations invalidate public entries.
- Successful anonymous public JSON responses allow 30 seconds of browser caching.
  This does not add a Cloudflare Workers edge cache. Credentials, errors, admin
  responses and HTML keep their prior cache restrictions.
- Metadata facets/count use one database statement. Profile HTML fetches its
  asset and location concurrently and skips unused related-location queries.
- Profile and secondary routes load separately; profile CSS leaves the initial
  bundle. Font discovery starts from HTML with preconnects. Responsive hero
  variants, correct image sizes and asynchronous decoding reduce image work.

Measured against the current catalog, gzip payloads fall from 22,441 to 5,097
bytes for 24 atlas cards, and from 11,623 to 2,624 bytes for 10 homepage cards.
The 1080px hero is 239,202 bytes versus 533,028 bytes for the original 1920px asset.

## Fog

- Cache text/control rectangles in document coordinates; scrolling only
  translates visible rectangles into the existing soft readability mask.
- Invalidate geometry for content, font, image-load and layout changes. Reuse
  GPU texture storage when mask dimensions are unchanged.
- Defer shader setup until idle after first paint. Pause while the mobile menu
  covers the page and resume without restarting the fog reveal.
- Detect sustained startup overload after a one-second warmup and 24 samples;
  adapt resolution sooner, with a cooldown and longer monitoring once stable.
  Shader layers, density, alpha, full-viewport coverage and header protection are
  unchanged.

## Verification

`npm test` covers request cancellation/cache isolation/freshness, complete-feed
retention, race handling, larger-catalog fallback, API compatibility, and existing
catalog/import invariants. `npm run build` checks TypeScript and production bundles.

Browser scripts cover the normal site flows, all 136 pins, fog geometry reuse,
mobile menu pause/resume, accessibility and performance behavior. The repeatable
`tests/performance.mjs` probe reports network counts/bytes, main-thread long tasks,
frame callback cadence and cold/warm navigation observations.

Performance probes run in headless Chromium with SwiftShader and a managed network
proxy. These are comparative development observations, not physical phone/GPU
benchmarks.

### Local results, October 12, 2026

- 53 automated tests and the production build passed.
- 16 core browser checks passed, including seven accessibility scans with no
  violations; nine focused performance behavior checks passed.
- All 136 numeric points arrived in one raw feed. Pan, zoom and pagination made
  zero additional atlas requests. Pagination left map screenshot pixels unchanged.
- Initial list-only browsing loaded no MapLibre code and created no WebGL context.
  Repeated marker selection and warm homepage navigation made no new API requests.
- A DPR 3 mobile viewport used a 780×1200 map buffer for 390×600 CSS pixels.
- 19 fog checks passed, including cached geometry reuse/invalidation, continuous
  scrolling, menu pause/resume, four touch viewport sizes and fallback behavior.
  Two additional accessibility scans found no violations. A 30-second sustained
  software-GPU sample averaged 25.16 fog draws/second with a stable 651×452 buffer.

Reports and screenshots are retained under `/workspace/phasm-performance/` in
`before`, `local-core`, `local-behavior` and `local-fog`. The baseline notes identify
excluded probe timings and the differences between frame callback cadence, fog
draw rate, network delay and physical-device performance.

Reproduce the focused behavior checks with:

```sh
PHASM_BASE_URL=http://localhost:5173 node tests/performance-behavior.mjs
PHASM_BASE_URL=http://localhost:5173 \
  PHASM_PERF_OUTPUT=/workspace/phasm-performance/comparison \
  node tests/performance.mjs
```

### Deployment and live verification

- URL: <https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev/>
- Source: `0d85920b2c81e85a572095de4653b1f8c2b6d340` on
  `codex/responsive-performance`.
- Worker version: `71ca3373-bf86-486a-a153-aa15bda10d84`.
- Review: <https://github.com/Chaze-2025/PHASM/pull/3>.
- Clean preparation, production build and explicit preview-config dry run passed.
  The existing isolated Worker/database were retained; no database writes,
  migrations, additional services or plan changes were needed.
- **32 final live checks passed**: 15 core, six atlas/catalog, nine performance
  behavior and two image-loading checks. No uncaught application errors were
  observed. The complete 136-point response exactly matches the pre-update JSON.
- Final image tests verify 720px mobile card selection at DPR 2 and zero unwanted
  original-photo downloads when filtering, paginating or changing routes. Explicit
  responsive sizes avoid the departing-image re-selection seen with native
  automatic sizing during the first live comparison.
- Preview indexing/path restrictions and public cache headers were verified.
  Profile HTML remains `no-store`; public metadata reports all 136 locations.

Final artifacts are in `live-core`, `live-atlas`, `live-behavior-final`,
`live-images` and `deployment` under `/workspace/phasm-performance/`.

The comparative probe found startup atlas requests fell from two to one;
pan/zoom/pagination requests fell to zero; a Europe filter uses one request rather
than three; and repeated marker previews and warm homepage navigation use no new
API requests. Same-document scroll JavaScript time fell from 169 to 134 ms on
desktop and 89 to 60 ms on mobile in the recorded samples. Desktop fog frame-rate
gains were small in SwiftShader: native/software-GPU work still dominates. No
physical-device FPS or population Web Vitals claim is made.

Fresh-context cold-homepage checks were repeated on the final deployed bundle
(`index-Bv-F3Xci.js`) with the same readiness condition and 1,500 ms observation
window. They selected the 1080px hero and 720px card variants with no unwanted
original photos or browser errors:

| Homepage transfer |      Before |     Final | Reduction |
| ----------------- | ----------: | --------: | --------: |
| Desktop, DPR 1    | 1,004,814 B | 765,416 B |    23.83% |
| Mobile, DPR 2     | 2,037,211 B | 764,479 B |    62.47% |

The final report is `/workspace/phasm-performance/after-final-home/report.json`.
