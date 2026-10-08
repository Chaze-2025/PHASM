# Service selection, quotas, and cost controls

Source review date: **2026-10-08 (UTC)**. Values below were checked against the linked providers' own documentation using Exa's page-fetch service; direct HTTP fetches from this development environment returned HTTP 403. This review establishes the documented terms and limits, not an uptime guarantee. Recheck these pages before public launch and after plan changes. No infrastructure was provisioned and no paid plan was enabled for this review.

## Map tiles: OpenFreeMap

Use MapLibre GL JS with the public style:

```text
https://tiles.openfreemap.org/styles/dark
```

The endpoint was fetched through Exa and returned a MapLibre style document (`version: 8`), with vector tiles at `https://tiles.openfreemap.org/planet` and glyphs and sprites on `tiles.openfreemap.org`. The official [style repository](https://github.com/hyperknot/openfreemap-styles) explicitly documents this Dark URL. The [quick-start guide](https://openfreemap.org/quick_start/) includes Vite worker setup and supported clients.

The [OpenFreeMap homepage and terms](https://openfreemap.org/) explicitly state:

- Public-instance use is free, with no stated limits on map views or requests, no registration, and no API keys.
- Commercial usage is allowed.
- The service is funded through donations and offers no SLA guarantee or personalized support.
- Attribution is required. Keep MapLibre's attribution control visible and readable: **OpenFreeMap © OpenMapTiles Data from OpenStreetMap**, with the provider's links. The OpenFreeMap part is optional under its instructions, but PHASM should retain it. Do not remove attribution when customizing styles.

OpenFreeMap is a reasonable free-tier choice for the engineering milestone. It is still an external dependency with no availability guarantee. Keep the style URL configurable (`VITE_MAP_STYLE_URL` is public configuration, never a secret), provide a useful list view and map error state, and check style, tile, sprite, glyph, and browser WebGL loading before launch. A future provider switch or self-hosted tiles does not require changing location data or the map client. Self-hosting a global tile service has substantial storage and operational costs and is not part of Phase 1.

The official style repository notes that Dark's upstream project is abandoned and that Dark has received fewer updates than Liberty. Track rendering and label quality as well as availability. The public service's lack of stated usage caps does not turn it into a contractual unlimited-capacity commitment.

### Why not silently fall back to OSM's public tile server?

The [OSMF raster tile usage policy](https://operations.osmfoundation.org/policies/tiles/) provides only best-effort service. It requires attribution, normal browser identification/referrers, honoring cache headers, and no bulk downloading or offline prefetch. It permits blocking inappropriate use without notice. Changing providers requires deliberate policy and attribution review; an automatic fallback could unexpectedly transfer all traffic to a donated service.

### Geographic search

Search PHASM's own location names, cities, states/regions, countries, and stored coordinates. This supports discovery within the editorial catalog without sending searches to a third party. It is not a comprehensive world-address geocoder; identify that limitation clearly.

Do not connect autocomplete to the public Nominatim API. The [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) caps the entire application's traffic at one request per second, forbids autocomplete, requires identification and attribution, and includes specific restrictions on automatically generated generic geocoding integrations. A later global geocoder needs a deliberately selected provider, terms review, caching, abuse control, and an application-wide rate limit. OpenFreeMap supplies map tiles, not geocoding.

## Cloudflare limits that matter

| Service | Documented free allowance / limit | Practical implication |
| --- | --- | --- |
| Workers | 100,000 dynamic requests per day; 10 ms CPU per invocation; 128 MB memory per isolate | Keep handlers small. Database wait time is excluded from CPU time, but parsing, validation, JWT verification, and JSON serialization consume it. Benchmark deployment CPU before launch. |
| Workers Static Assets | Static-asset requests are free and unlimited under normal static serving; 20,000 files per Worker version; 25 MiB per file | Serve JS, CSS, fonts, and initial media through the asset binding directly. Avoid sending every asset through the Worker. |
| D1 reads | 5 million rows read per day | Rows scanned count, not merely rows returned. A full 5,000-row scan consumes 5,000 reads even when the API returns ten matches. |
| D1 writes | 100,000 rows written per day | Index updates also consume writes. Batch imports should be bounded and monitored. |
| D1 storage | 5 GB total per free account; **500 MB per free database**; 10 databases per free account | The account allowance is not the capacity of one database. Store media objects outside D1. |
| D1 query limits | 50 queries per free Worker invocation; 100 bound parameters per SQL statement; 30-second maximum query duration | Avoid per-record queries, giant `IN` clauses, and monolithic imports. |
| D1 search limits | `LIKE` / `GLOB` pattern maximum is 50 bytes | Validate UTF-8 byte length, including wildcard characters, or use bounded FTS5 queries. Character-count validation alone is insufficient. |
| D1 recovery | 7 days of Time Travel on the free plan | Document exports and restore exercises before launch; this is not long-term archival backup. |
| R2 Standard | 10 GB-month storage, 1 million Class A operations, 10 million Class B operations per month; Internet egress is free | The allowance applies only to Standard storage. R2 is a metered product; free egress does not make reads/writes or storage unlimited. |
| Turnstile | Up to 20 widgets, 10 hostnames per widget, unlimited challenges/verification requests, 7-day analytics lookback | Useful for future submissions, but it does not replace authentication, authorization, moderation, or rate limits. No public submissions should be enabled yet. |

Official references: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 SQL/extensions](https://developers.cloudflare.com/d1/sql-api/sql-statements/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/).

D1's free daily limits reset at 00:00 UTC. On the free plan, exhausting read/write quotas prevents further queries until reset; this is a service failure condition, not automatic unlimited overage. Exhausted storage prevents relevant writes and schema operations. Surface a retryable API error and retain the list/map UI's error states.

Workers Paid currently starts at **$5/month**, with 10 million requests and 30 million CPU milliseconds included; excess is $0.30/million requests and $0.02/million CPU milliseconds. Paid D1 includes 25 billion reads/month, 50 million writes/month, and 5 GB storage, then meters usage. R2 Standard overage is currently $0.015/GB-month, $4.50/million Class A operations, and $0.36/million Class B operations, with billing-unit rounding. These are reference values, not a PHASM bill estimate or authorization to upgrade.

Workers pricing distinguishes direct asset serving from newer Workers Caching: when Workers Caching is enabled, even cached requests can be billed at the request rate. Do not assume that adding a cache makes all Worker requests free. Configure and verify the actual deployed routing/account plan.

## Safeguards and scale beyond 5,000 profiles

The database schema should retain stable IDs, unique canonical slugs, normalized category/phenomenon relations, publication/privacy status, and numeric latitude/longitude. Published coordinates must already be privacy safe. Do not return private coordinates to the browser and merely hide them in the interface.

The following are operational design requirements, not claims that all launch controls are already enabled:

1. Query only the current map bounding box, applying publication status and catalog filters in SQL. Index the fields used for geographic and publication filtering. Split antimeridian bounds into two ranges; validate finite, legal coordinates.
2. Bound list page sizes and marker payloads on the server. Return an explicit truncation/zoom-in indication when the marker limit is reached. Never imply that a capped subset represents every location. Use a lightweight marker projection rather than complete profile histories, sources, and galleries.
3. At country/world zoom, use bounded geographic bins or server-produced clusters as the catalog grows. Client clustering makes rendering smoother, but it does not reduce database scans, network transfer, or the size of an unbounded GeoJSON download.
4. Debounce searches and map `moveend` requests, cancel obsolete requests, and avoid requerying on every pointer movement. Use deterministic query/cache keys and bounded public cache lifetimes; never cache authenticated editorial responses publicly.
5. Use indexed equality/prefix queries where appropriate and FTS5 for scalable catalog text search. D1 explicitly documents FTS5 support; do not assume PostGIS or SQLite R*Tree is available without verifying the deployed runtime. `LIMIT` bounds response size but does not by itself prevent a full scan.
6. Exercise `EXPLAIN QUERY PLAN`, observe `meta.rows_read` / `rows_written`, and test realistic geographic distributions above 5,000 records before public launch. Record p95 latency, scanned rows, response size, map memory, and mobile behavior. Plan around D1's per-database single-threaded execution.
7. Keep imports private, bounded, validated, and duplicate checked. Review content and privacy before publication. Process batches below D1 statement/parameter limits; maintain an audit trail and recoverable exports.
8. Keep images optimized and cacheable. Before enabling R2 uploads, impose per-user count/size limits, strip sensitive EXIF coordinates, validate actual media type, quarantine pending review, and add orphan cleanup. Storage quotas and retention rules must be server enforced.
9. Monitor quota consumption and errors. Set usage alerts and paid-plan CPU limits if a paid upgrade is later authorized; alerts are not spending caps. Apply application-level rate limits to expensive/public routes before broad launch.
10. Keep all privileged credentials in Worker secrets, never in Vite-prefixed variables, the client bundle, or source control. Do not enable submissions until identity, moderation, media consent, abuse protections, and appeals are implemented and tested.

## Launch checks

- Confirm the selected account plan, bindings, actual database capacity, and quota visibility.
- Review tile-provider terms again and verify attribution on narrow mobile screens.
- Test network failure, WebGL failure, D1 quota errors, and stale/aborted search requests.
- Run a realistic 5,000+ location query and interaction benchmark; initial seed content is not a scale test.
- Reassess any optional service before activating it. R2, Turnstile, global geocoding, analytics, and paid Cloudflare plans are independent decisions.
