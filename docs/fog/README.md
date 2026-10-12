# Volumetric homepage mist

The `codex/volumetric-mist` revision adds finer, coherent mist and stable coverage through mobile viewport changes to the continuous homepage atmosphere. Fog mounts only on the homepage. The atlas content and all 136 pins remain as documented in the [USA atlas integration](../USA-ATLAS-130.md); this rendering change requires no database or catalog updates.

The [volumetric mist QA record](VOLUMETRIC-MIST-QA.md) is the place for this revision's validation and deployment evidence. The [rolling fog QA record](ROLLING-FOG-QA.md) and [original mist QA](QA.md) describe the preceding implementations, not verification of this renderer.

## Shape, light and motion

One fixed WebGL canvas, mounted through a React portal directly under `document.body`, extends beyond the viewport and composites over homepage photographs, cards and section boundaries. Five samples along each perspective ray integrate one coherent three-dimensional density field from front to back. Three noise scales form the banks; finer erosion frays their edges into filaments. Near mist retains more structure, while distant samples are softer. A depth-dependent lighting approximation produces silver crests and darker green-gray interiors.

The density moves through a finite-difference curl field, a continuously varying prevailing breeze and a bounded backtrace that bends connected wisps. Scrolling imparts a small gust through a damped spring, so motion settles gradually after input ends. Smoothed scroll also changes the sampled depth. This is physics-informed procedural transport and volumetric rendering, not a full fluid simulation. Beer–Lambert extinction controls transmission and scattering along the ray; directional scattering and local optical depth approximate illumination without a separate shadow-ray pass.

The shader shares one deterministic, repeating 256×256 noise texture whose paired channels interpolate neighboring depth slices. Each depth sample uses seven noise lookups, for 35 in total plus the readability mask. Fixed, continuous depth samples avoid screen-locked grain and temporal shimmer. Premultiplied alpha keeps mist fringes clean over imagery and dark surfaces. There are no smoke-image assets or new animation dependencies.

A broad density envelope favors the lower viewport and edges while allowing banks to cross the center. The top feathers gently below the navigation. A smooth exposure shoulder approaches a 20% alpha ceiling without flattening dense banks against a hard clamp; typical pixels are lighter. Density is slightly lower on narrow viewports. The initial appearance fades in over 2.2 seconds. Ordinary scrolling refreshes the readability mask without hiding the fog, resetting its phase or repeating the reveal.

## Continuous viewport coverage

The previous canvas followed the instantaneous visual viewport height. Mobile browser bars could expose its bottom edge between geometry updates, and each height change resized and cleared the drawing buffer while also rescaling the noise field. The new surface covers the union of layout, client and visual viewport bounds, initially extending at least 160 CSS pixels beyond each edge. It keeps its allocation through ordinary toolbar and keyboard height changes and grows in 64-pixel steps when the visible area approaches an edge. Small viewport changes therefore reuse the drawing buffer instead of clearing it on every event.

A height high-water mark retains coverage when browser chrome expands again. Pinch offsets and transient visual viewport dimensions are bounded so they cannot cause unbounded surface growth. A material layout-width change or physical orientation change resets the allocation. The CSS fallback uses the large viewport height before the renderer supplies its overscanned dimensions.

Shader positions are anchored in layout CSS pixels and divided by a stable, width-derived world scale. Live visual viewport height never rescales the camera or noise, so browser bar and keyboard changes do not stretch the banks. The readability mask uses the same surface origin. These measures address the mobile cutoff mechanism; physical iPhone Safari behavior still requires device verification, distinct from browser emulation.

## Readability and interaction

A low-resolution mask softly reduces fog around actual text lines and controls. It uses broad elliptical gradients rather than cutting out foreground rectangles. At their centers, text masks retain 78% of the fog density and control masks retain 72%; overlapping gradients use the darker value rather than adding multiple reductions. Photos, cards and section surfaces remain part of the continuous atmosphere. A custom `data-fog-protect` element receives the same soft control treatment.

The renderer caches text and control rectangles in document coordinates. Scrolling translates those rectangles into the mask, at most 20 times per second, without measuring text again. Resize, font/image loading and homepage content changes invalidate the geometry cache. Texture storage is reused when the mask dimensions stay the same. The canvas is decorative, hidden from assistive technology and has `pointer-events: none`; links, forms and cards continue to receive input directly.

The portal surface uses `z-index: 31`, above the opaque header at 30, to avoid Chromium WebGL occlusion cropping the bottom of the fog. Navigation stays clear through an explicit shader boundary: `uClearTop` tracks the header's bottom, density remains zero for another 16 CSS pixels, then feathers in until 180 pixels below the header. Opening the mobile menu fades the atmosphere's CSS opacity to zero over 180 milliseconds and pauses rendering. Closing the menu resumes its saved phase without restarting the reveal.

## Rendering budget and fallback

The drawing buffer ignores device pixel ratio. Its initial scale is 58% of CSS dimensions on desktop and 65% on layout viewports no wider than 760 pixels, further limited to a 1024-pixel long edge and a roughly 500,000-pixel area budget. Overscan fits inside that existing budget; it is not an additional fullscreen pass. Scheduling targets 30 frames per second on desktop and 24 on narrow viewports through animation-frame gating. These are configured targets, not measured device performance.

Initialization waits for idle time after first paint. Sustained slow frame cadence lowers rendering resolution through balanced and economy levels while retaining the same fields and motion. Startup adaptation uses a one-second warmup and 24-sample window, followed by longer 60-sample monitoring once stable and a cooldown after resolution changes. A sustained mean frame gap more than 35% over the target, with most frames late, lowers resolution; this catches persistent 20 fps output against a 30 fps target without penalizing normal mobile cadence. If the mean gap stays more than 80% over target at the lowest level, the decoration disables itself. The safeguard observes frame timing, including possible rendering backpressure; it does not measure GPU power or battery use. See the [performance update](../PERFORMANCE.md) for the later responsiveness changes and validation.

Hidden tabs pause rendering. Navigation removes listeners, observers and GPU resources. Reduced motion, forced colors, Save-Data and reported device memory of 2 GB or less disable the effect before WebGL initialization. Unsupported WebGL or high-precision shaders, a reported major performance caveat and context loss also fall back to the usable page without fog. Print styles hide the layer. Browser hints do not identify every device's low-power or battery state.

## Review and maintenance

- [Volumetric mist verification and deployment record](VOLUMETRIC-MIST-QA.md)
- [Historical rolling-fog verification](ROLLING-FOG-QA.md)
- [Historical perimeter-mist verification](QA.md)
- [Renderer](../../src/AtmosphericFog.tsx), [volume shader](../../src/fog-shader.ts), [viewport allocation](../../src/fog-viewport.ts) and [scoped styles](../../src/atmospheric-fog.css)
- [Focused browser checks](../../tests/fog.mjs)
- [Viewport-transition browser checks](../../tests/fog-viewport-browser.mjs)
- [Existing isolated preview workflow](../../deploy/midnight-preview/README.md)

This revision requires no database migration, catalog update or additional service. Any deployment must record the actual source commit and Worker version separately from the earlier atlas release. Desktop/mobile captures should show continuous fog over photographs and cards, legible text, working controls and uninterrupted movement during scrolling. Browser emulation alone cannot establish physical iPhone battery, thermal or Safari behavior.
