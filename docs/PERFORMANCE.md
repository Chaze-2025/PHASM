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
