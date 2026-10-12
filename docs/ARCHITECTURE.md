# PHASM architecture

This describes the implemented foundation and USA atlas integration on `codex/usa-atlas-130`. An isolated Cloudflare evaluation preview is deployed; the [USA atlas integration record](USA-ATLAS-130.md) identifies the exact deployed source and verified coordinate update. Production launch and community writing workflows remain separate work.

## Runtime and repository layout

```text
Browser
  React + React Router + CSS/Tailwind build
  ├── /api/* → Cloudflare Worker → D1
  ├── /locations/:slug → Worker HTML metadata/content → React
  ├── /images/* and build assets → Workers Static Assets
  └── MapLibre GL JS → OpenFreeMap tiles/styles/fonts/sprites
```

Vite and `@cloudflare/vite-plugin` provide the local Worker/D1 development environment. Production configuration uses a Worker with an `ASSETS` binding and D1 binding `DB`. `wrangler.jsonc` intentionally contains a placeholder remote database ID and a localhost canonical origin.

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | Router, shared layout, route titles, lazy atlas/admin loading, error boundary |
| `src/pages.tsx` | Discovery, reusable profiles, saved places, explanatory/planned pages |
| `src/Atlas.tsx` | MapLibre interaction, viewport loading, filters, preview cards, list pagination |
| `src/Admin.tsx` | Token gate, searchable record list, location creation/editing |
| `src/components.tsx`, `src/styles.css` | Reusable visual components and responsive identity |
| `src/api.ts` | Fetch/error handling, aborted request cleanup, browser-local saved collection |
| `shared/types.ts` | Location, source, list, and GeoJSON contracts |
| `worker/index.ts` | HTTP routing, D1 reads, editorial auth/writes, initial HTML SEO, sitemap |
| `worker/validation.ts` | Server-side schema/URL/privacy/bounds validation and identity normalization |
| `worker/location-sql.ts` | Shared SQL statements for imports and transactional editorial saves |
| `worker/seo.ts` | Profile structured data, including omission of approximate or unavailable geo coordinates |
| `migrations/` | Catalog, search indexes, related data, future community/editorial tables, and corrected case-insensitive pagination index |
| `content/` | Researched seed records and exact image-license metadata |
| `content/research/usa-130-geocodes.json` | Reviewed coordinate pairs, source URLs, point kinds, evidence and inspection dates for 75 added map points |
| `scripts/` | Non-destructive local seed and validated SQL generation |
| `tests/backend.test.ts` | SQLite-backed Worker behavior tests, including 5,100-location aggregation |

The visual system uses charcoal/obsidian surfaces, warm ivory text, antique-brass accents, serif display typography, restrained motion, and real architectural imagery. Lists remain available when WebGL or external map loading fails. CSS supports reduced motion and responsive layouts; formal accessibility certification is not claimed.

## Public API

Public reads expose only `published` records. API responses currently use `Cache-Control: no-store`; shared public caching is an explicit future optimization, not an enabled cost control.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/locations` | Search/filter/paginate published profiles; default page size 24, maximum 50 |
| `GET /api/locations/:slug` | Published profile and up to three nearby or related records |
| `GET /api/atlas` | Published lightweight GeoJSON points or geographic aggregates in the requested bounds |
| `GET /api/meta` | Published categories, phenomenon tags, regions, classifications, and count |
| `GET /locations/:slug` | Initial HTML containing profile text, sources, image attribution, and SEO metadata |
| `GET /sitemap.xml` | Published location URLs and core discovery routes; current cap 45,000 locations |
| `GET /robots.txt` | Sitemap reference; disallows `/admin` and `/api/` crawling |

Filters are `q`, `category`, `phenomenon`, `access`, `tours`, `region`, and `classification`. `page` and `pageSize` apply to lists. Query values are bound parameters. The server bounds input lengths and pagination values and reports malformed requests with 400-class responses. Unexpected failures return a generic 503 response rather than database details.

`q` uses FTS5 across location name, city, state, and country. It extracts up to eight letter/number terms, quotes them as prefix searches, and joins them with `AND`; the server accepts at most 160 characters. This is catalog geographic discovery, not an address geocoder. No runtime geocoding integration is enabled. Reviewed geographic research is stored in the catalog and its provenance registry before publication.

## Geographic loading and scalability

The browser asks for `bbox=west,south,east,north` and `zoom` after map movement stops, and aborts a superseded request. Search runs on explicit form submission, avoiding per-keystroke API traffic. List filters are reflected in the URL. The list covers matching catalog records; map points additionally reflect the current viewport. The current catalog has 136 mapped records: 61 original points and 75 newly sourced approximate reference points. A viewport can therefore contain fewer map results than the complete matching list.

The Worker validates coordinate ranges and supports antimeridian-crossing bounds. D1 indexes include publication status with longitude/latitude and latitude/longitude, plus common category, region, and access filters. The query first counts matching records. At zoom below 5 or more than 500 matches, SQL groups them into geographic bins and returns representative centers and counts. Otherwise it returns lightweight individual points. Responses contain at most 500 features, without downloading full profiles into the Worker to cluster them.

MapLibre adds visual client clustering, carrying server bin counts into cluster totals. Clicking a bin zooms in; clicking an individual marker opens a profile preview. The database still scans matching rows for counts and aggregation: bounded transfer does not imply constant query cost. The current 5,100-record test verifies correctness and bounded payloads, not production latency, concurrent throughput, CPU usage, or D1 quota economics. Those benchmarks remain required. Large-catalog list pagination currently uses offset pagination; assess keyset pagination before very deep browsing becomes common.

Nearby results use a bounded latitude/longitude window and an approximate distance ordering, with antimeridian handling. When there are no nearby records, the API falls back to shared category/region. The UI labels the combined section “Other stories in the archive” rather than claiming that every suggested place is nearby.

## Data model

`locations` stores stable IDs, unique slugs, a unique normalized identity key, geographic identity, a numeric coordinate pair or two nulls, one flexible category, classification, access/tours states, publication status, coordinate precision, featured status, and a timestamp. A validated `data_json` snapshot contains the complete profile for compact retrieval; indexed columns duplicate the fields used for query planning. All supported write paths update the snapshot and relational fields together.

`location_phenomena` provides multiple tags per place. `location_sources` stores labelled history, reports, and visiting references. `locations_fts` is an external-content FTS5 index maintained by insertion/update/deletion triggers. `editorial_audit` records location ID, action/status, and time; it does not yet identify a human editor or retain field-by-field revisions.

Every profile separates `history` from `reports`. Published records require attributed reports and at least one report source. History is optional; a nonempty history must have a historical source. These are structural validation rules, not an automatic truth or independence check. `unknown` is an explicit access/tour value. Haunting classification is `established`, `local-legend`, or `community-discovery` and is separate from publication status.

The current 136-record catalog has no withheld pins. The schema still supports future records without reviewed coordinates using two nulls and `coordinatePrecision: "withheld"`. Such records remain in search, filters, saved places and profiles, but are excluded from map queries, geographic nearby calculations and structured geo metadata. Numeric coordinates must be a complete valid pair.

All 75 newly researched points use `coordinatePrecision: "approximate"`: they identify a sourced building, property, marker, park, road segment or other named feature, without claiming a surveyed visitor entrance. Their decimal values are retained from the inspected source or geocoder response. Private locations may use these approximate reference points without forced decimal rounding; the validator continues to reject private locations labelled `exact`. Coordinates do not alter ownership, booking requirements or permission to enter. The original 61 mapped records remain unchanged.

The public geographic registry records each research ID, coordinate pair, precision, point kind, source URL/title, evidence and inspection date. The converter records its checksum and per-location geographic provenance. `usa-130-sources.json` retains the 431 original bibliographic records and appends 75 geographic references. Those references are tracked separately from historical and paranormal source roles; coordinate inspection does not change a narrative's research date.

The shared profile currently has one primary photograph or placeholder, reused in its visual-record section. A rich multi-image gallery and managed upload workflow remain unfinished. R2 is not provisioned or bound.

## Editorial security boundary

The `/admin` browser shell is reachable, but the API denies all administrative data and functions without authorization. There is no security reliance on hiding the URL, a navigation link, or `robots.txt`.

| Endpoint | Authorization and action |
| --- | --- |
| `GET /api/admin/locations` | Valid bearer token; includes unpublished records; bounded search and pagination |
| `POST /api/admin/locations` | Valid bearer token; validate and create a record |
| `PUT /api/admin/locations/:id` | Valid bearer token; validate and update an existing matching ID |

The secret must exist in the Worker environment and be at least 32 characters; otherwise the API returns 503. Tokens are compared through fixed-length SHA-256 digests with a full-byte comparison. The editor holds its token only in memory and sends it in the Authorization header. Editorial mutation requests reject a supplied cross-origin `Origin` header. There is no cookie-based editorial session.

Bodies must be JSON and are streamed through a 96 KiB size ceiling before parsing. The validator limits content length, checks source/image URLs, rejects non-finite coordinates, and requires complete publication fields. Unique IDs, slugs, and normalized identities protect against straightforward duplicates. Validated edits execute the location, tag, source, and audit statements in a D1 batch. Each source insert stays below D1's 100-bound-parameter limit.

HTML is escaped when creating initial profile content and structured data escapes `<`. Worker responses include nosniff, frame denial, a referrer policy, and restricted camera/microphone permissions. Canonical URLs come from configured `SITE_URL`, not the incoming Host header. Administrative Worker responses are noindex. Static asset headers are defined separately in `public/_headers`.

This is a private editorial foundation, not complete production identity infrastructure. Before public deployment, add a server-verified identity gateway or per-editor login, role authorization, MFA, rate limits, secret rotation procedures, richer audit history, and security review. Application-wide rate limiting is not yet implemented. Public APIs use no-store responses, so quota/caching work must also precede significant traffic.

## Initial HTML and SEO

On a direct location URL request, the Worker loads the published record and uses Cloudflare `HTMLRewriter` to put an accessible article into the app root. It injects a title, description, canonical URL, Open Graph fields, a Twitter summary-card declaration, and `Place` JSON-LD. Structured geo coordinates are omitted for approximate pins. React subsequently renders the interactive application; this is server-generated initial profile content, not a full React SSR/hydration stack.

Missing or unpublished profile URLs return an HTML 404 with noindex. The sitemap is generated from published database records. Only profile direct requests receive database-derived initial HTML; other routes remain the frontend shell. Client profile navigation updates the visible page title and description. Social crawlers should be tested against direct profile URLs and the final canonical origin before launch. Sitemap partitioning is needed before exceeding its current 45,000-profile query cap.

## Import and local reproducibility

The CLI validates the same `Location` contract as the Worker, detects in-file normalized duplicates, and can write reviewable SQL without applying it. Database constraints handle collisions with existing data; fuzzy geographic/name matching and human merge review are future enhancements.

The seed script explicitly invokes Wrangler with `--local`. It reads existing IDs, adds missing seed records, rejects identity conflicts, and preserves existing editorial versions. It writes SQL to a temporary directory and removes that file after execution. It is not a remote publishing tool or a destructive database reset.

`scripts/geocode-revision.ts` generates a guarded update from the deployed 136-record baseline `9d76541aec32d093a2caa2f3d2a617d73ebe22f3`. It requires the existing IDs, protects every field of the 61 already mapped records, and permits coordinate fields for the 75 enriched records plus one exact reviewed Devil’s Tramping Ground access-notice replacement. Shared revision guards check complete live JSON, relational projections, source relationships and tags before any writes. Unexpected drift is rejected; an already-applied update is accepted without duplicate audit entries. The generated revision appends `mapped:usa-atlas-75:2026-10-12` audit entries and preserves member relationships. SQL generation itself performs no database operations.

Use the commands in [README](../README.md). Do not copy local development credentials into a public build or provision production services simply to run the preview.

## Future systems already represented in the schema

The following tables are foundations only; the presence of a table does not mean its workflow is functional:

- `users`, `reviews`, `review_phenomena`, `media`, `review_replies`, and `review_reactions` support a unified review model with optional visitor-experience ratings and reported/none/unspecified experiences.
- `content_reports`, `moderation_actions`, `appeals`, and `location_suggestions` reserve moderation, appeals, and private suggestion payloads.
- `collections` and `collection_locations` reserve authenticated collections. The current Saved page instead uses browser local storage and does not synchronize or authenticate.
- `editorial_content` and its location join table reserve case files, encyclopedia entries, and trails. Current phenomenon definitions are introductory application content; no case files or curated trails are claimed as completed.

There are no public submission endpoints. Writes to reviews, submissions, suggestions, and uploads explicitly return 403. Registration, user sessions, verification, upload consent, EXIF removal, virus/media checks, spam prevention, reports/replies/reactions, moderation queues, administrative removal/appeals, and synced personal collections must be implemented and tested before enabling those workflows.

## Verification and remaining operational work

See [QA](QA.md) for original foundation outcomes and [USA atlas integration](USA-ATLAS-130.md) for the 136-profile import and coordinate update status; documentation of a test command is not a passing result. The [content review](CONTENT.md) describes the original seed and licensing approach. See [service limits](SERVICES.md) for dated provider terms and quota safeguards.

Before a production release: run production D1/Worker CPU and concurrency benchmarks, test iPhone/WebGL and keyboard/screen-reader behavior, introduce rate limiting and measured public caching, enable useful quota/error monitoring, perform backup/restore exercises, harden identity, complete content review, and recheck provider terms. The authorized evaluation-preview updates do not enable community submissions or constitute a production launch.
