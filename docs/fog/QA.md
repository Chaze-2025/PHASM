# Atmospheric mist: browser review

> Historical record: this page and its artifacts describe the original perimeter mist. Its clipping and complete foreground-exclusion requirements are superseded by the continuous homepage atmosphere on `codex/rolling-fog`. See [the current implementation](README.md) and [rolling fog verification record](ROLLING-FOG-QA.md); the results below do not validate that new renderer.

The effect is limited to the homepage. It preserves the green-and-brass design and clear photography, and never mounts in the Haunted Atlas or location profiles.

## Reproduce

With a seeded local server on port 5176:

```sh
PHASM_BASE_URL=http://localhost:5176 PHASM_FOG_RECORD=1 node tests/fog.mjs
```

The focused suite runs 120 seconds of continuous animation by default. Set `PHASM_FOG_LONG_RUN_MS` to change that duration and `PHASM_SCREENSHOT_DIR` to write artifacts elsewhere. It makes no database writes and needs no production diagnostics or debug endpoint. Playwright Chromium and ffmpeg are development tools; the application adds no animation dependency.

## Evidence

| View              | Before                                   | After                                                                                 |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Desktop homepage  | [Original](artifacts/before-desktop.png) | [Mist](artifacts/homepage-desktop.png)                                                |
| Mobile homepage   | [Original](artifacts/before-mobile.png)  | [Mist](artifacts/homepage-iphone.png)                                                 |
| Desktop, scrolled | —                                        | [Protected location cards](artifacts/homepage-desktop-scrolled.png)                   |
| Mobile, scrolled  | —                                        | [Protected location cards](artifacts/homepage-iphone-scrolled.png)                    |
| Atlas             | —                                        | [Map without mist](artifacts/atlas-no-fog.png)                                        |
| Reduced motion    | —                                        | [Mist disabled](artifacts/homepage-reduced-motion.png)                                |
| WebKit mobile     | —                                        | [Top](artifacts/webkit-mobile.png) · [Scrolled](artifacts/webkit-mobile-scrolled.png) |

Baseline screenshots and component geometry came from the existing `d3c7a21` preview. The suite compares the new desktop and mobile hero, typography, photograph, search, navigation, and section bounds against those measurements; the fog does not change the layout.

[Real-time motion recording](artifacts/fog-real-time-25s.mp4). The mist is deliberately faint. The recording retains its real playback speed and the screenshots retain the actual contrast, without amplification.

## Results

The production build and 8 backend tests passed. All 34 existing browser checks passed: [16 core checks](artifacts/regression-browser.json) and [18 supplemental checks](artifacts/regression-mobile.json). The final [focused mist report](artifacts/report.json) records 18 passing checks; [WebKit](artifacts/webkit-report.json) adds 9 passing checks. Across the existing and focused suites, 11 axe scans reported zero violations.

The separate [120-second stability measurement](artifacts/stability-120s.json) retained a single 720×500 drawing buffer at the 1440×1000 viewport, about 17 frames per second, an unchanged reported 14.3 MB JavaScript heap, and one additional browser long task during the sampled interval. The final focused rerun uses a shorter five-second stability check; the full measurement is linked separately rather than relabeled.

Actual fog-on/fog-off screenshot comparisons found zero changed pixels in protected content at all tested viewports. Thousands of changed pixels in the unoccupied perimeter confirm that the comparison measures a visible effect. The one visibility exception is the 844×390 initial view: the header and full-bleed photograph occupy almost the entire viewport, so the mist correctly withdraws. Its protected pixels are still checked, and visible perimeter mist is required after scrolling.

## Focused validation

- Pixel comparisons hide only the fog layer and compare the resulting screenshots. The viewport center and the rectangles occupied by navigation, headings, body text, links, controls, cards, and photographs must remain unchanged (one RGB level is allowed for screenshot quantization). This runs at the top of the page and after scrolling on desktop and each mobile viewport.
- Chromium tests cover 1440×1000, 375×667, 390×844, 430×932, and 844×390, including touch taps, menu use, searching, scrolling, and portrait/landscape changes.
- The map is checked for absence of the effect, a loaded MapLibre canvas, zoom, and drag behavior. Location profiles also remain fog-free.
- Reduced motion disables rendering before any fog WebGL context is created. Changing the preference while the page is open destroys/recreates the renderer safely. Context-loss, unsupported-WebGL, data-saver, and low-memory fallbacks remain usable.
- Visibility-change handling is tested with a simulated hidden document and a real dispatched visibility event; frame counts stop and then resume. This is a lifecycle test, not a claim of physical mobile background-tab testing.
- Continuous animation is sampled for 120 seconds, checking a single canvas, bounded render dimensions, advancing frames, stable JavaScript heap, and absence of uncaught exceptions. These measurements use the container's software GPU, not an iPhone battery or hardware benchmark.
- Two focused axe WCAG 2 A/AA and 2.1 AA scans cover desktop and mobile reduced motion.

The independent [WebKit report](artifacts/webkit-report.json) records nine passing checks on Linux WebKit 27.2: visible running mist, frame advancement, menu taps, scroll settling, narrow/tall resize, reduced-motion change, atlas navigation, home remount, and no browser exceptions. Its supporting Linux libraries were extracted into scratch storage; application and system dependencies were not changed.

The rendered desktop and mobile screenshots and frames from the real-time recording were visually inspected. The final recording preserves a fixed scroll position, checked at five-second intervals, for its full 25 seconds. Wisps remain in unoccupied perimeter space; clear photographs, card surfaces, text, and controls retain their original appearance. No abrupt tiling, opaque clouds, center haze, or new overflow was observed.

## Limits

These are Chromium and WebKit browser tests with mobile viewport/touch emulation, not physical iPhone testing. Safari browser chrome, keyboard safe-area changes, thermal behavior, and battery impact still benefit from review on a real phone using the Cloudflare preview. The effect deliberately disables itself when the browser reports reduced motion, data saving, low memory, unsupported graphics, or persistently poor rendering cadence.
