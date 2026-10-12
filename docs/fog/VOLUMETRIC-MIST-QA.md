# Volumetric mist and mobile viewport coverage

This records the `codex/volumetric-mist` update, starting from `3a68955`, on October 12, 2026. The source changes only the homepage decoration and its verification/deployment documentation. There are no catalog, coordinate, map or database changes.

## Reproduced defect

The previous live release sized the canvas to the instantaneous VisualViewport. With a 390×844 layout and a synthetic visible height of 740, its bottom stopped at y=740 while page content continued to y=844. A keyboard viewport offset of 160 also left the top uncovered. Six toolbar-height events caused twelve drawing-buffer dimension writes, clearing the canvas repeatedly.

These three regressions reproduced independently in Chromium 156 and WebKit 27.2. Other baseline coverage/lifecycle checks passed. Baseline artifacts are retained at `/workspace/phasm-mist-depth/before` and `/workspace/phasm-mist-depth/before-webkit`.

The fix keeps a surface extending beyond the union of layout and visual viewport bounds, reuses its allocation through toolbar and keyboard changes, and maps shader/mask positions through a stable layout origin and width. The same six events now cause zero bitmap writes. Surface allocation remains bounded and resets for a true width or orientation change.

## Rendering review

Five samples along a perspective ray integrate a coherent three-dimensional density field. Curl transport, a varying breeze and damped scroll gusts move the mist; fine erosion frays the banks. Depth illumination, directional scattering and Beer–Lambert extinction give the atmosphere depth. This is physics-informed procedural rendering, not a full fluid solver.

An initial jittered sample pattern produced visible screen-locked grain and was removed. An overly strong fine ridge field also produced cellular outlines; continuous subtractive erosion gives softer, irregular wisps. Text and controls keep their soft density mask, and photos, card surfaces and section boundaries remain inside the same atmosphere.

## Reproduce

```sh
npm test
npm run build
PHASM_BASE_URL=http://localhost:5173 \
PHASM_SCREENSHOT_DIR=/tmp/phasm-mist-viewport \
PHASM_FOG_BROWSERS=chromium,webkit node tests/fog-viewport-browser.mjs
PHASM_BASE_URL=http://localhost:5173 \
PHASM_SCREENSHOT_DIR=/tmp/phasm-mist-motion \
PHASM_FOG_LONG_RUN_MS=120000 PHASM_FOG_RECORD=1 node tests/fog.mjs
```

Playwright WebKit requires its platform libraries. The optional `PHASM_WEBKIT_EXECUTABLE` selects a configured launcher; no extra runtime dependency is shipped to the site.

## Verification and deployment

Local verification used the built application at `http://localhost:5175`, without Vite hot reload:

- Production build, TypeScript and all 61 automated tests passed, including eight viewport-allocation cases.
- All 19 focused fog checks passed. Desktop and four touch viewports covered rendering, readability, layout, scrolling, menu pause/resume, rotation, search, map interaction, reduced motion, hidden tabs, graphics loss and low-resource fallbacks.
- All 14 viewport checks passed across Chromium 156 and WebKit 27.2: visible bottom-band mist, full layout/visual coverage, keyboard offsets, orientation, scrolling, zero bitmap writes over toolbar cycles and one graphics context.
- Both axe scans reported zero accessibility violations, and there were zero uncaught browser errors.
- The continuous 120-second run averaged **28.68 fps** on the software GPU. It adapted from 816×612 to 490×367, then maintained that bounded resolution with monotonically advancing frames and no context/document restart. This measures the test environment, not an iPhone.
- Text contribution was at most 20 RGB levels at the 99th percentile and 22 maximum; controls were 19 and 21. These fog-on/off pixel differences complement visual review rather than measuring contrast ratios by themselves.

The actual-opacity phone and desktop stills and the frame sequence from a 25-second real-time recording were reviewed for fine structure, changing depth and continuity across content. Artifacts are retained at `/workspace/phasm-mist-depth/production-fog`, including `report.json`, the viewport screenshots, `motion-frames.jpg` and `fog-real-time-25s.mp4`. Final cross-engine viewport checks are at `/workspace/phasm-mist-depth/production-viewport`.

An earlier development-server run was interrupted by a document reload and its aggregate frame rate was discarded. The stability test now rejects counter/context discontinuities. A separate uninterrupted probe found the older adaptation threshold tolerated sustained 50 ms frames against a 33 ms target. The new mean-gap plus majority-late gate correctly lowers resolution without treating normal 33/50 ms mobile cadence as overload.

Deployment identifiers and live verification will be recorded after publication through the existing isolated preview configuration.

## Limits

Browser runs use Linux software rendering, touch emulation and synthetic VisualViewport events. They reproduce the canvas geometry/clearing defect, but do not constitute physical iPhone Safari, battery or thermal measurements. The configured 30/24 fps targets are not hardware performance guarantees.
