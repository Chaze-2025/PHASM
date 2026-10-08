# Homepage atmosphere

This focused enhancement adds one decorative mist renderer to the homepage. It preserves the restored dark green, near-black, and antique-brass design, clear photography, existing layout, and all application features. No fog is mounted on the Haunted Atlas, location profiles, or other routes.

## Appearance and protection

Three continuous procedural noise fields produce irregular, slowly rising silver-gray wisps with a slight green undertone. There are no smoke images, particles, photo filters, full-screen blur, animation libraries, or additional dependencies. The fields move at different rates without a timed loop reset.

Fog is confined to the lower 63% of the viewport and two narrow outer strips: at most 112 CSS pixels per side on desktop and 26 on mobile. It feathers toward the center and upward, with alpha capped at 8.5%; typical opacity is much lower. The central viewport remains completely clear.

The renderer uses a cached exclusion mask for actual foreground element bounds. Text, links, navigation, controls, cards, photographs, and media remain fully transparent in the fog layer, including an eight-pixel safety margin and feathered shoulders. Overlapping exclusions can only strengthen protection. Custom future foreground elements can use `data-fog-protect`. The atmosphere is hidden from assistive technology and uses `pointer-events: none`.

Scrolling, toolbar/keyboard changes, resizing, image/font loading, and homepage content changes invalidate the mask. The mist withdraws while geometry changes, then fades back over 1.8 seconds after the viewport settles. This prevents an old mask from passing over newly positioned content. The visual viewport and dynamic viewport height accommodate mobile browser resizing without changing page layout or safe-area spacing.

## Rendering budget and fallback

The small WebGL shader draws only the two outer strips. Its canvas ignores device pixel ratio, uses half resolution on desktop or 72% on mobile, and caps its longest internal dimension at 768 pixels. A timeout followed by an animation frame limits scheduling to at most 18 frames per second. There are no per-frame layout reads.

Hidden tabs pause rendering. Navigation releases GPU resources and listeners. Reduced motion, forced colors, the browser's Save-Data preference, and reported device memory of 2 GB or less disable the effect before GPU initialization. Unsupported WebGL/high-precision shaders, a major performance caveat, context loss, or sustained poor frame cadence also disable it. The page remains fully usable with no atmospheric layer. Browser hints do not expose every device's battery or low-power mode.

The performance safeguard observes frame cadence and JavaScript submission time, not GPU power consumption. Automated Chromium and Linux WebKit checks provide useful regression evidence, but cannot establish physical iPhone battery life, thermal behavior, or every Safari version. A physical iPhone review remains useful before broader rollout.

## Review and maintenance

- [Screenshots, real-time recording, and test results](QA.md)
- [Isolated Cloudflare preview and deployment instructions](PREVIEW.md)
- [Renderer](../../src/AtmosphericFog.tsx) and [scoped styles](../../src/atmospheric-fog.css)
- [Focused browser checks](../../tests/fog.mjs)

The preserved design baseline is commit `d3c7a21db5c7e8134b81c7603eef274a0adbcf73`. The new development branch is `dev/phasm-atmospheric-fog`. Preview deployment reuses the existing isolated Worker and read-only D1 binding without migrations, content writes, new services, public submissions, or a production launch.
