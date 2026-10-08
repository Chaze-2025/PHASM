# Midnight Séance — PHASM 1.3

An atmospheric gateway to haunted places, using cold architecture, historical photographic objects, and restrained engraved details. The atlas remains the primary discovery tool. The identity must never imply that decoration or historical photographic illusion is paranormal evidence.

## Color roles

The source of truth is [`src/design-tokens.css`](../../src/design-tokens.css). Shared surfaces, typography, cards, navigation, profiles, and map controls consume semantic tokens. MapLibre reads these tokens for its WebGL paint properties when the style loads.

| Foundation      | Value     | Role                                                                   |
| --------------- | --------- | ---------------------------------------------------------------------- |
| Midnight Black  | `#0B111D` | Dominant page background, photographic shadows, text on silver buttons |
| Deep Storm Blue | `#172334` | Panels, dossier mounts, filters and controls                           |
| Iron Slate      | `#35465B` | Selected controls, marker rings, structural accents                    |
| Mist Silver     | `#AABBC8` | Supporting text, interactive accents, primary buttons, map markers     |
| Ghost Ivory     | `#E3E8E9` | Headings, reading text and selected markers                            |
| Tarnished Brass | `#B8A68F` | Sparse brand, archival registration and historical details             |

Use `--bg`, `--panel`, `--panel2`, `--ivory`, `--muted`, `--accent`, `--border`, and `--focus` in components. `--surface-deep` and `--surface-soft` create depth without warm or green surfaces. Borders can be quiet when decorative; focus indicators and interactive state changes must remain apparent. Error text uses a restrained rose (`--danger`), accompanied by readable error messages.

Ghost Ivory and Mist Silver exceed WCAG AA text contrast against Midnight Black and Deep Storm Blue: respectively 15.27:1 / 9.58:1 on Midnight Black and 12.81:1 / 8.03:1 on Deep Storm Blue. The mist-filled primary button uses Midnight Black text. Do not use Iron Slate as small body text or rely on color alone to communicate a state. Automated rendered contrast checks are recorded with the test results; image-backed text also requires visual inspection.

## Typography and spacing

- Cormorant Garamond, with Georgia fallback, is reserved for display headings and location names. DM Sans, with a system sans-serif fallback, carries navigation, body copy, captions and controls.
- Body copy is approximately 16–17px with 1.7–1.85 line height. Secondary labels are at least 12px on the main refined screens. Forms use at least 16px on narrow touch layouts to avoid Safari focus zoom.
- Major mobile controls have at least 44px touch targets. Buttons generally use 48px. Fine print is never the sole source of an important action or disclosure.
- The spacing tokens define 4, 8, 12, 16, 24, 32, 48 and 72px steps. Page gutters adapt from roughly 22–24px on phones to 64px on desktop; individual editorial compositions may use intermediate spacing.
- Header and footer account for device safe areas. Atlas height uses dynamic viewport units; compact previews and scrollable filter panels retain access to controls on short phones.

## Photographic identity

The homepage opens with real, licensed Eastern State Penitentiary photography, cooled and shaded through CSS. The photograph remains recognizable and credited. Featured cards retain the actual location's image; missing images use an explicitly labelled architectural illustration.

The spiritualist archive features William H. Mumler's historical portrait from Getty's CC0 collection, with its full original card visible. A restrained monochrome treatment and photographic mount supply atmosphere. The explanatory text identifies staged spirit photography as a cultural artifact, not verified evidence. Its sitters are not associated with any PHASM location. The separate Stanley excerpt uses the hotel's own location photograph and attributed existing folklore.

Stanley's dossier labels its gallery as contemporary location photography with a cool monochrome presentation. No unrelated antique portrait is inserted into its gallery. Original source and license links remain available. See [image provenance](IMAGE-PROVENANCE.md) and the [machine-readable record](../../content/archival-images.json).

The threshold brand mark, registration circles, mount corners and engraved rules are contemporary decorative graphics. They are not reproductions of authenticated occult artifacts. Avoid invented historical meanings, sigils, apparitions, heavy grain overlays or simulated damage.

## Compositions and interaction

- **Homepage:** strong corridor hero and direct search; photographic featured cards; real-map teaser; a full-width archival feature; open local-lore composition; compact recent-record rows; region links; clearly marked planned case files and trails.
- **Atlas:** cold land and water, readable mist labels with midnight halos, restrained rings, opaque controls and selected preview. Roads, place names, coordinates, clustering and geographic queries retain their meaning and behavior. The teaser is a screenshot of this real map, with provider attribution.
- **Dossier:** photographic hero, registration details, explicit history/report reading key, comfortable narrative widths, source register, gallery mount, official visiting information and related places. Claims retain their existing qualifications. Community participation remains closed.
- **Cards:** recognizable photography, geographic labels, serif location names, small attributed-phenomenon labels, clear save controls. Local legends retain an explicit classification.

## Motion and accessibility

Use short menu and preview reveals and subtle pointer-hover photographic transitions. No flicker, particles, ghost animation, ambient audio, forced intro or scroll hijacking. `prefers-reduced-motion: reduce` removes CSS animation and transitions; the map's existing reduced-motion behavior is preserved.

Keyboard navigation, visible focus, skip link, mobile-menu focus management, form labels, error states, and list alternatives to the map remain available. Contrast and screen geometry are checked in Chromium at desktop and mobile sizes. These checks do not constitute physical iPhone or Safari testing.

## Boundaries

This is a visual refinement of Phase 1.1, based on `cf915ba`, preserving `9da8948` in its ancestry. No location records, schema, backend, import pipeline, editorial authorization, original Worker configuration or community functionality were changed. The new Cloudflare preview uses its own Worker and the existing read-only preview database. Main, production and previous preview configurations remain separate.
