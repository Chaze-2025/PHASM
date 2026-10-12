# Rolling homepage fog: verification record

Status: **local verification passed; deployment pending**. The results below were recorded on October 12, 2026.

| Item | Current record |
| --- | --- |
| Working branch | `codex/rolling-fog` |
| Starting source | `ede8fff`, recorded deployment of all 136 atlas pins |
| Change | One continuous homepage fog layer with three moving noise fields and soft text/control attenuation |
| Reviewed source commit | Pending |
| Local build and automated checks | 35 automated tests, TypeScript, production build and preview configuration validation passed |
| Desktop/mobile visual and motion review | 18 focused fog checks; two accessibility scans; real-time 25-second recording |
| Deployed Worker version and live verification | Pending |

The [implementation guide](README.md) describes the current shader, motion, readability mask and adaptive rendering budget. [QA.md](QA.md) and its existing artifacts describe the original perimeter mist. Its unchanged-center and completely protected-photo checks are historical requirements superseded by this revision; those results do not validate the new effect.

## Reproduce without replacing historical artifacts

Use a local checkout with the existing catalog seeded, then start the application:

```sh
npm run dev -- --port 5176
```

In another terminal, run the focused checks with a separate artifact directory:

```sh
PHASM_BASE_URL=http://localhost:5176 \
PHASM_SCREENSHOT_DIR=/workspace/phasm-rolling-fog-verification \
PHASM_FOG_RECORD=1 \
node tests/fog.mjs
```

`PHASM_FOG_LONG_RUN_MS` controls the continuous sample duration; its default is 120,000 milliseconds. Record the duration actually used with the results. `PHASM_FOG_RECORD=1` requests a real-time motion recording. The test harness uses development tools such as Playwright and ffmpeg, not new application dependencies. An artifact path or a documented command is not evidence of a successful run.

Run the appropriate application regressions and production build alongside the focused review:

```sh
npm test
npm run build
PHASM_BASE_URL=http://localhost:5176 node tests/browser.mjs
```

Keep the original `docs/fog/artifacts` directory intact. Save new reports, screenshots and recordings together, then link the actual retained files when results are recorded below.

## Review criteria

- Visible banks cross photographs, card surfaces, the viewport center and section boundaries without rectangular gaps, hard strips or a repeating scroll fade. Inspect still frames and motion at their actual opacity and playback speed.
- Text, navigation, search, menu and card controls remain readable and usable on desktop and narrow touch viewports. Check keyboard interaction, portrait/landscape resizing and overflow.
- Scrolling advances one continuous renderer without recreating WebGL or restarting the initial reveal. Route changes remove the effect from the atlas and profiles, and returning home creates one renderer.
- Reduced motion, forced colors, data saving, low memory, unsupported graphics, context loss and hidden-tab handling retain their intended fallbacks. Verify whichever cases the executed harness actually covers.
- Record buffer dimensions, advancing frames, selected quality level, sampled duration, browser exceptions and relevant stability measurements. The configured 30/24 fps targets and 500,000-pixel budget are not substitute performance results.
- Run accessibility and layout regressions appropriate to the changed homepage. Preserve the 136-location catalog, map behavior and existing read-only preview restrictions.

## Results and artifacts

Local verification used Node.js 24.19.0 and Playwright 1.64.0 with Chromium/SwiftShader. `npm test` passed all 35 automated tests; TypeScript, the production build and explicit preview configuration validation passed.

The focused fog suite passed **18 of 18 checks**, including desktop layout and input, overlap across photos/card edges/section surfaces, bottom-of-viewport coverage, continuous scrolling, mobile menu behavior, resizing, reduced motion, visibility lifecycle, context loss and unsupported/low-memory/data-saving fallbacks. Two axe accessibility scans reported zero violations, with zero uncaught browser errors. Touch viewports were 390×844, 375×667, 360×800 and 844×390; desktop was 1440×1000.

Eleven fog-on/off pixel comparisons found zero changed header pixels. The highest text contribution was 22 RGB levels at the 99th percentile and 24 maximum; controls were 16 and 18 respectively. Every measured bottom band received fog. Five continuous-scroll checks kept the canvas visible and running without context recreation. These pixel budgets complement visual review; they are not a standalone contrast-ratio measurement.

The 120-second software-rendered stability run averaged **25.04 frames per second**. The renderer adapted from 835×580 to 651×452 by the 16-second sample, then held that balanced resolution while remaining active. Sampled JavaScript heap stayed around 16.1 MB. These are test-environment observations, not hardware or battery guarantees.

Actual-opacity desktop and mobile screenshots were visually reviewed for continuous clouds, clear typography and absence of text-shaped holes. A 25-second real-time MP4 was recorded at 1024×768 and 25 fps; it retains the actual playback speed and contrast. Private artifacts are at `/workspace/phasm-fog-quality/after/report.json`, `/workspace/phasm-fog-quality/after/homepage-desktop.png`, the corresponding touch screenshots, and `/workspace/phasm-fog-quality/after/fog-real-time-25s.mp4`.

An early bottom cutoff was isolated with an independent plain WebGL canvas: an opaque header triggered Chromium compositor occlusion. Raising the portal surface above that header while explicitly clearing the header region in the shader fixed it. Final checks used normal browser flags and unmodified page styles; the suite now guards bottom-band coverage.

## Deployment

Pending. The previous atlas deployment remains documented in [USA-ATLAS-130.md](../USA-ATLAS-130.md). The presence of the existing Cloudflare URL does not demonstrate that rolling fog has been published.

If deployed, record the source commit, clean preparation provenance, Worker version, deployment time and live verification. This visual revision requires no database migration or content update. Verify the homepage effect and route restrictions on the deployed version while confirming atlas/profile behavior and the 136 mapped records remain intact.

## Limits

Desktop and mobile viewport emulation can test layout, interaction and renderer lifecycle. It does not establish physical iPhone battery consumption, thermal behavior, mobile browser chrome or every Safari version. Note any actual physical-device testing separately.
