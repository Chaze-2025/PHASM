# PHASM design system — green palette refinement

An atmospheric gateway to haunted places, using historic architecture, historical photographic objects, and restrained engraved details. The atlas remains the primary discovery tool. The identity must never imply that decoration or historical photographic illusion is paranormal evidence.

## Color roles

The source of truth is [`src/design-tokens.css`](../../src/design-tokens.css). Shared surfaces, typography, cards, navigation, profiles, and map controls consume semantic tokens. MapLibre reads these tokens for its WebGL paint properties when the style loads.

| Foundation     | Value     | Role                                                   |
| -------------- | --------- | ------------------------------------------------------ |
| Charcoal Green | `#111513` | Page background and text on brass buttons              |
| Forest Panel   | `#191E1B` | Cards, panels, filters and controls                    |
| Moss Slate     | `#354238` | Structural borders, selected surfaces and marker rings |
| Sage Gray      | `#A1A69E` | Supporting text                                        |
| Warm Ivory     | `#ECE9DF` | Headings, body text and selected markers               |
| Antique Brass  | `#C2AD7C` | Brand details, links, primary buttons and map markers  |

These restore the original green-and-brass direction at the owner's request. The archival compositions, mobile improvements and functional architecture from Phase 1.3 remain in place.

Use `--bg`, `--panel`, `--panel2`, `--ivory`, `--muted`, `--accent`, `--border`, and `--focus` in components. `--surface-deep` and `--surface-soft` create depth within the charcoal-green palette. Borders can be quiet when decorative; focus indicators and interactive state changes must remain apparent. Error text uses a restrained rose (`--danger`), accompanied by readable error messages.

Warm Ivory and Sage Gray provide readable text on the dark surfaces. Brass primary buttons use Charcoal Green text. Do not use Moss Slate as small body text or rely on color alone to communicate state. Automated contrast checks and visual inspection cover desktop and mobile rendering.

## Typography and spacing

- Cormorant Garamond, with Georgia fallback, is reserved for display headings and location names. DM Sans, with a system sans-serif fallback, carries navigation, body copy, captions and controls.
- Body copy is approximately 16–17px with 1.7–1.85 line height. Secondary labels are at least 12px on the main refined screens. Forms use at least 16px on narrow touch layouts to avoid Safari focus zoom.
- Major mobile controls have at least 44px touch targets. Buttons generally use 48px. Fine print is never the sole source of an important action or disclosure.
- The spacing tokens define 4, 8, 12, 16, 24, 32, 48 and 72px steps. Page gutters adapt from roughly 22–24px on phones to 64px on desktop; individual editorial compositions may use intermediate spacing.
- Header and footer account for device safe areas. Atlas height uses dynamic viewport units; compact previews and scrollable filter panels retain access to controls on short phones.

## Photographic identity

The homepage opens with real, licensed Eastern State Penitentiary photography in its original color and brightness. The photograph remains recognizable and credited. Featured cards retain the actual location's image; missing images use an explicitly labelled architectural illustration.

The spiritualist archive features William H. Mumler's historical portrait from Getty's CC0 collection, with its full original card visible. The original scan colors and photographic mount supply atmosphere. The explanatory text identifies staged spirit photography as a cultural artifact, not verified evidence. Its sitters are not associated with any PHASM location. The separate Stanley excerpt uses the hotel's own location photograph and attributed existing folklore.

Stanley's dossier labels its gallery as contemporary location photography in its original colors. No unrelated antique portrait is inserted into its gallery. Original source and license links remain available. See [image provenance](IMAGE-PROVENANCE.md) and the [machine-readable record](../../content/archival-images.json).

The threshold brand mark, registration circles, mount corners and engraved rules are contemporary decorative graphics. They are not reproductions of authenticated occult artifacts. Avoid invented historical meanings, sigils, apparitions, heavy grain overlays or simulated damage.

Photographs have `filter: none` and normal color blending. Full-image tint overlays, dimming gradients and card image shading are removed. The homepage separates copy from the clear image on desktop and places a compact photograph above the copy on mobile. Location titles use a solid caption area below the hero photograph. Small source and classification labels have their own backing; the photographs themselves are not darkened. Image cropping and responsive sizing remain, and original files and licensing records are unchanged.

## Compositions and interaction

- **Homepage:** strong corridor hero and direct search; photographic featured cards; real-map teaser; a full-width archival feature; open local-lore composition; compact recent-record rows; region links; clearly marked planned case files and trails.
- **Atlas:** dark green cartography, readable sage labels with charcoal halos, restrained rings, opaque controls and selected preview. Roads, place names, coordinates, clustering and geographic queries retain their meaning and behavior. The teaser is a screenshot of this real map, with provider attribution.
- **Dossier:** photographic hero, registration details, explicit history/report reading key, comfortable narrative widths, source register, gallery mount, official visiting information and related places. Claims retain their existing qualifications. Community participation remains closed.
- **Cards:** recognizable photography, geographic labels, serif location names, small attributed-phenomenon labels, clear save controls. Local legends retain an explicit classification.

## Motion and accessibility

Use short menu and preview reveals and subtle pointer-hover image scale transitions, without color filtering. No flicker, particles, ghost animation, ambient audio, forced intro or scroll hijacking. `prefers-reduced-motion: reduce` removes CSS animation and transitions; the map's existing reduced-motion behavior is preserved.

Keyboard navigation, visible focus, skip link, mobile-menu focus management, form labels, error states, and list alternatives to the map remain available. Contrast and screen geometry are checked in Chromium at desktop and mobile sizes. These checks do not constitute physical iPhone or Safari testing.

## Boundaries

This is a visual refinement of Phase 1.1, based on `cf915ba`, preserving `9da8948` in its ancestry. No location records, schema, backend, import pipeline, editorial authorization, original Worker configuration or community functionality were changed. The new Cloudflare preview uses its own Worker and the existing read-only preview database. Main, production and previous preview configurations remain separate.
