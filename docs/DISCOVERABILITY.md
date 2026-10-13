# Public discovery and indexing

The published PHASM site is intentionally indexable following the October 13,
2026 request. Its current canonical origin is configured by `SITE_URL`:

https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev

The `midnight-preview` deployment directory retains its historical name. The
active wrapper now permits public indexing while continuing to deny admin and
development paths, forward only public bindings, and reject all writes. The
older `deploy/preview` deployment is unchanged.

## Crawlable content

- Home, the Haunted Atlas, profiles, the state directory, state result pages,
  About, and the phenomena index include useful HTML before JavaScript runs.
  The initial homepage uses the same responsive header and hero layout, with
  its photograph marked high priority, so React does not replace a plain list
  above the fold. The atlas also links published international profiles.
- `/haunted-places` links all 50 states. State pages contain up to 24 published
  profiles, ordinary links to previous/next pages, and links to the filtered map.
- `/api/discover` reads current published U.S. counts. Directory pages and
  sitemap pagination use the same state definitions and page size as the client.
- `/sitemap.xml` includes published profiles, core public pages, and every
  nonempty state directory page. Drafts, accounts, saved collections, empty
  placeholder case files, and admin routes are excluded.
- `/robots.txt` permits public crawling and advertises the sitemap. Admin and
  API paths remain disallowed; account, saved, placeholder, and error HTML can
  be crawled to read their `noindex` directives.
- Unknown HTML paths return HTTP 404; public trailing-slash variants redirect.
  Canonicals omit search/tracking filters, except meaningful state pagination.
- Each public page has a title, description, canonical URL, Open Graph and
  Twitter previews. Placeholder illustrations use the branded 1200×630 social
  card; photographed profiles retain their actual images.
- JSON-LD describes the site, organization, collections, breadcrumbs, and actual
  places. Approximate map pins never produce precise `GeoCoordinates` claims.

The React application replaces the server content and keeps metadata current
while navigating. This does not expose drafts or expand public database writes.
All directory/catalog queries require published status.

## Repeatable deployment checks

Prepare the reviewed branch with the existing verified photo workspace; the
`codex/discovery-occult` branch requires it to preserve all nationwide photos.
Use the explicit `deploy/midnight-preview/wrangler.json` configuration.
Preparation copies source security headers without injecting a global `noindex`.

Run the backend, wrapper, discovery and client metadata tests, then the complete
suite and production build. Check actual prepared/live responses:

1. Home, a photo profile, an approximate profile, the state index, and a later
   state page return HTTP 200 with one canonical and no blocking robots header.
2. `robots.txt` permits crawling; every sitemap URL uses `SITE_URL`; later state
   pages retain their page parameter while tracking parameters do not.
3. The server HTML contains profile links and readable content with JavaScript
   disabled. A browser can navigate to a state page, next page, and map filter.
4. Unknown pages return 404/noindex; admin/development paths remain blocked;
   community writes return 403 and other writes return 405.
5. The social card, favicon, touch icon, and all existing location photos load.

Search engines choose when to crawl, index, and rank pages. This release enables
that process; it does not guarantee an indexing date or ranking. If a permanent
custom domain is introduced, change `SITE_URL` and the deployment validator
together, add canonical redirects from the old origin, and use the permanent
origin in the sitemap. Domain ownership and search-console verification require
the site owner's account and domain access; none is implied by these changes.

## Occult visual identity

PHASM now uses an original triple-moon pentacle in place of the architectural
threshold mark. The header/footer, browser favicon, touch icon and social preview
share the same artwork. Fine lunar dividers, a decorative hero seal, engraved
rules and warm gold accents carry it through the homepage without covering the
photographic subjects or adding an animation loop. The existing volumetric fog,
reduced-motion behavior, map renderer and all location/photo data are retained.

The star and moons are decorative brand artwork, with no claim that the design
is an authenticated historical seal. Navigation retains readable text and focus
states; decorative SVGs are hidden from assistive technology.

Regenerate the original social image and touch icon with:

```sh
node scripts/generate-brand-assets.mjs
```

The checked-in social image is 1200×630 and the touch icon is 180×180. No external
images or network calls are used by this generator. Brand SVG sources and the
React component are checked in alongside the generated images.

## Verified live release — 2026-10-13

Published at <https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev/>.
The new state directory is `/haunted-places`.

- Source commit: `f8b7e53f0973751f24db3da11bdad82e7a8d2151`.
- Worker version: `607178ed-398c-48b5-b65d-4e852916253a`.
- Prior Worker version: `bac4c33b-c9ae-4686-b400-c9210b81e32d`.
- Branch: `codex/discovery-occult`.
- Existing Worker/D1 account, database and free resources are unchanged.
- No database writes or migrations were performed in this release.
- The verified package retains all 33 research photos at their existing URLs.

Validation: all 203 tests pass, along with import type-check, clean production
build, deployment dry run and formatting. The local production browser suite
passed 15/15; eight dedicated discovery checks verified all 2,859 profiles are
reachable through ordinary HTML links, directory behavior at 320/390/820/1440px,
metadata, no-JavaScript pages, accessibility and error handling. The initial and
React homepage geometry matches for the header, hero, image, heading, search and
hero footer. Observed cold-load layout shift was 0.0183 desktop and 0.00062 mobile;
these are local browser observations, not field Core Web Vitals measurements.

Six focused live checks passed after deployment. Public pages allow indexing;
robots advertises the live sitemap; admin and unknown pages remain 404. The
sitemap contains 3,018 URLs: all 2,859 published profiles, 154 state directory
pages including pagination, and five core pages. All 50 states display live
counts; state pagination, filtered map links and visible state chips work.
Desktop and mobile show the new lunar identity and existing mist. Placeholder
profiles use the branded social PNG and photographed profiles retain their
photos. All 2,859 map point IDs and coordinates match the prior published catalog
exactly. No uncaught application errors occurred.

Private operational evidence is in `/workspace/phasm-discovery-review/`:
`deployment-source.json`, `deploy.log`, `final-unit-tests.log`,
`final-directory-results.json`, `initial-layout-results.json`,
`sitemap-coverage.json`, and `live/results.json`. The retained previous Worker
version supports application rollback; no catalog rollback is needed.
