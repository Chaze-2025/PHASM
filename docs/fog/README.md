# Rolling homepage fog

The `codex/rolling-fog` revision replaces the earlier perimeter mist with one continuous atmosphere across the homepage. It starts from `ede8fff`, the recorded deployment of all 136 atlas pins. The atlas content, map, profiles, access restrictions and community features remain as documented in the [USA atlas integration](../USA-ATLAS-130.md). Fog mounts only on the homepage.

Local verification has passed; deployment results are recorded in the [rolling fog QA record](ROLLING-FOG-QA.md). The [original mist QA](QA.md) preserves evidence for the superseded perimeter effect.

## Shape, light and motion

One fixed WebGL canvas, mounted through a React portal directly under `document.body`, spans the visual viewport and composites over homepage photographs, cards and section boundaries. The shader combines three independently drifting three-dimensional noise fields at different scales and depths. Broad warping creates billows, finer noise breaks up their edges, and a directional lighting approximation gives the banks silver crests and darker green-gray undersides. This is a procedural density effect rather than a ray-marched physical volume.

The fields share a deterministic, repeating 256×256 noise texture; its paired channels interpolate neighboring depth slices. Four noise octaves shape each field. Exponential optical-depth accumulation combines the layers, with premultiplied alpha to keep their fringes clean over imagery and dark surfaces. There are no smoke-image assets or new animation dependencies.

A broad density envelope favors the lower viewport and edges while still allowing banks to cross the center. The top feathers gently below the navigation. Alpha is capped at 18%; typical pixels are lighter. Density is slightly lower on narrow viewports. The renderer draws the complete viewport without side-strip clipping or separate card and photograph surfaces.

Time advances continuously, and a smoothed scroll position supplies different parallax amounts to the three fields. Scrolling refreshes the readability mask without hiding or restarting the fog. The initial appearance fades in over 2.2 seconds; ordinary scrolling does not repeat that fade. Resizing and browser visual-viewport changes update the canvas geometry without altering document layout.

## Readability and interaction

A low-resolution mask softly reduces fog around actual text lines and controls. It uses broad elliptical gradients rather than cutting out foreground rectangles. At their centers, text masks retain 78% of the fog density and control masks retain 72%; overlapping gradients use the darker value rather than adding multiple reductions. Photos, cards and section surfaces remain part of the continuous atmosphere. A custom `data-fog-protect` element receives the same soft control treatment.

The renderer measures text with DOM ranges and refreshes the mask only when geometry is dirty, at most 20 times per second while scrolling. Resize, font/image loading and homepage content changes invalidate it. The canvas is decorative, hidden from assistive technology and has `pointer-events: none`; links, forms and cards continue to receive input directly.

The portal surface uses `z-index: 31`, above the opaque header at 30, to avoid Chromium WebGL occlusion cropping the bottom of the fog. Navigation stays clear through an explicit shader boundary: `uClearTop` tracks the header's bottom, density remains zero for another 16 CSS pixels, then feathers in until 180 pixels below the header. Opening the mobile menu fades the atmosphere's CSS opacity to zero over 180 milliseconds while its animation phase continues, so closing the menu restores the ongoing motion.

## Rendering budget and fallback

The drawing buffer ignores device pixel ratio. Its initial scale is 58% of CSS dimensions on desktop and 65% on viewports no wider than 760 pixels, further limited to a 1024-pixel long edge and a roughly 500,000-pixel area budget. Scheduling targets 30 frames per second on desktop and 24 on narrow viewports through animation-frame gating. These are configured targets, not measured device performance.

Sustained slow frame cadence lowers rendering resolution through balanced and economy levels while retaining the same fields and motion. If poor cadence persists at the lowest level, the decoration disables itself. The safeguard observes frame timing, including possible rendering backpressure; it does not measure GPU power or battery use.

Hidden tabs pause rendering. Navigation removes listeners, observers and GPU resources. Reduced motion, forced colors, Save-Data and reported device memory of 2 GB or less disable the effect before WebGL initialization. Unsupported WebGL or high-precision shaders, a reported major performance caveat and context loss also fall back to the usable page without fog. Print styles hide the layer. Browser hints do not identify every device's low-power or battery state.

## Review and maintenance

- [Current rolling fog verification and deployment record](ROLLING-FOG-QA.md)
- [Historical perimeter-mist verification](QA.md)
- [Renderer](../../src/AtmosphericFog.tsx) and [scoped styles](../../src/atmospheric-fog.css)
- [Focused browser checks](../../tests/fog.mjs)
- [Existing isolated preview workflow](../../deploy/midnight-preview/README.md)

This revision requires no database migration, catalog update or additional service. Any deployment must record the actual source commit and Worker version separately from the earlier atlas release. Desktop/mobile captures should show continuous fog over photographs and cards, legible text, working controls and uninterrupted movement during scrolling. Browser emulation alone cannot establish physical iPhone battery, thermal or Safari behavior.
