import type {
  AtlasFeature,
  AtlasGeoJSON,
  Location,
  LocationSummary,
} from "../shared/types";
import { ATLAS_COMPLETE_POINT_LIMIT } from "../shared/types";
import {
  HttpError,
  identityKey,
  integerParam,
  parseBounds,
  validateLocation,
} from "./validation";
import { locationStatements } from "./location-sql";
import {
  breadcrumbStructuredData,
  collectionStructuredData,
  escapeHtml,
  locationStructuredData,
  renderPageHtml,
  siteStructuredData,
  type PageMetadata,
} from "./seo";
import {
  DIRECTORY_PAGE_SIZE,
  US_STATES,
  findState,
  type DiscoveryResponse,
} from "../shared/discovery";
import { imageLicenseUrl } from "../shared/image-license";
import { homeHeaderHtml, homeHeroHtml } from "./home-html";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  EDITORIAL_READ_ONLY?: string;
  SITE_URL?: string;
}
type Row = { data_json: string };
type Filter = { where: string; values: (string | number)[] };
const MAX_BODY = 96 * 1024;
const publicHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  "X-Frame-Options": "DENY",
};
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: publicHeaders });
}
function publicJson(data: unknown): Response {
  return Response.json(data, {
    headers: {
      ...publicHeaders,
      // Brief browser reuse for anonymous catalog reads. This does not enable
      // a Workers edge cache; publication changes expire within 30 seconds.
      "Cache-Control": "public, max-age=30",
      Vary: "Authorization, Cookie",
    },
  });
}
function fromRow(row: Row): Location {
  return JSON.parse(row.data_json) as Location;
}
function summary(location: Location): LocationSummary {
  const {
    history: _history,
    reports: _reports,
    accessNotes: _accessNotes,
    officialUrl: _officialUrl,
    sources: _sources,
    imageCredit: _imageCredit,
    imageSource: _imageSource,
    ...card
  } = location;
  return card;
}

export function buildFilters(
  params: URLSearchParams,
  includeDrafts = false,
): Filter {
  const parts = includeDrafts ? ["1 = 1"] : ["l.status = 'published'"];
  const values: (string | number)[] = [];
  const q = params.get("q")?.trim();
  if (q) {
    if (q.length > 160)
      throw new HttpError(400, "Search is limited to 160 characters.");
    const terms = q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
    if (!terms.length)
      throw new HttpError(400, "Search needs at least one letter or number.");
    parts.push(
      "l.rowid IN (SELECT rowid FROM locations_fts WHERE locations_fts MATCH ?)",
    );
    values.push(terms.map((term) => `"${term}"*`).join(" AND "));
  }
  for (const key of [
    "category",
    "access",
    "tours",
    "region",
    "classification",
  ] as const) {
    const value = params.get(key);
    if (value) {
      if (value.length > 150)
        throw new HttpError(400, `Invalid ${key} filter.`);
      parts.push(`l.${key} = ?`);
      values.push(value);
    }
  }
  const phenomenon = params.get("phenomenon");
  if (phenomenon) {
    if (phenomenon.length > 100)
      throw new HttpError(400, "Invalid phenomenon filter.");
    parts.push(
      "EXISTS (SELECT 1 FROM location_phenomena p WHERE p.location_id = l.id AND p.phenomenon = ?)",
    );
    values.push(phenomenon);
  }
  if (includeDrafts && params.get("status")) {
    parts.push("l.status = ?");
    values.push(params.get("status")!);
  }
  if (params.get("state")) {
    const raw = params.get("state")!;
    if (raw.length > 150) throw new HttpError(400, "Invalid state filter.");
    const state = findState(raw);
    if (!includeDrafts && !state)
      throw new HttpError(400, "Unknown U.S. state.");
    parts.push("l.state = ?");
    values.push(state?.name || raw);
    if (!includeDrafts) {
      parts.push("l.country = ?");
      values.push("United States");
    }
  }
  return { where: parts.join(" AND "), values };
}

async function listLocations(
  db: D1Database,
  params: URLSearchParams,
  admin = false,
  compact = false,
): Promise<Response> {
  const page = integerParam(params.get("page"), 1, 1, 100000);
  const pageSize = integerParam(params.get("pageSize"), 24, 1, 50);
  const filter = buildFilters(params, admin);
  const [count, result] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM locations l WHERE ${filter.where}`,
      )
      .bind(...filter.values)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT l.data_json FROM locations l WHERE ${filter.where} ORDER BY l.featured DESC, l.name COLLATE NOCASE, l.id LIMIT ? OFFSET ?`,
      )
      .bind(...filter.values, pageSize, (page - 1) * pageSize)
      .all<Row>(),
  ]);
  const locations = result.results.map(fromRow);
  return (admin ? json : publicJson)({
    locations:
      compact || (!admin && params.get("format") === "summary")
        ? locations.map(summary)
        : locations,
    total: count?.total ?? 0,
    page,
    pageSize,
  });
}

async function getLocation(
  db: D1Database,
  slug: string,
): Promise<Location | null> {
  const row = await db
    .prepare(
      "SELECT data_json FROM locations WHERE slug = ? AND status = 'published'",
    )
    .bind(slug)
    .first<Row>();
  return row ? fromRow(row) : null;
}

async function getProfile(
  db: D1Database,
  slug: string,
): Promise<{ location: Location; nearby: Location[] } | null> {
  const location = await getLocation(db, slug);
  if (!location) return null;
  const discoveries: Location[] = [];
  if (location.latitude !== null && location.longitude !== null) {
    // A small indexed bounding search avoids sorting the full catalog for each profile.
    const south = Math.max(-90, location.latitude - 8);
    const north = Math.min(90, location.latitude + 8);
    const rawWest = location.longitude - 12;
    const rawEast = location.longitude + 12;
    const west = rawWest < -180 ? rawWest + 360 : rawWest;
    const east = rawEast > 180 ? rawEast - 360 : rawEast;
    const longitudeClause =
      west > east
        ? "(longitude >= ? OR longitude <= ?)"
        : "longitude BETWEEN ? AND ?";
    const longitudeScale = Math.cos((location.latitude * Math.PI) / 180) ** 2;
    const nearby = await db
      .prepare(
        `SELECT data_json FROM locations WHERE status = 'published' AND id != ? AND latitude BETWEEN ? AND ? AND ${longitudeClause} ORDER BY ((latitude - ?) * (latitude - ?) + MIN((longitude - ?) * (longitude - ?), (360 - ABS(longitude - ?)) * (360 - ABS(longitude - ?))) * ?) LIMIT 3`,
      )
      .bind(
        location.id,
        south,
        north,
        west,
        east,
        location.latitude,
        location.latitude,
        location.longitude,
        location.longitude,
        location.longitude,
        location.longitude,
        longitudeScale,
      )
      .all<Row>();
    discoveries.push(...nearby.results.map(fromRow));
  }
  if (!discoveries.length) {
    // The interface labels these "Other stories in the archive": where a
    // region has no nearby coverage yet, offer editorially related places.
    const related = await db
      .prepare(
        "SELECT data_json FROM locations WHERE status = 'published' AND id != ? AND (category = ? OR region = ?) ORDER BY (category = ?) DESC, name COLLATE NOCASE LIMIT 3",
      )
      .bind(location.id, location.category, location.region, location.category)
      .all<Row>();
    discoveries.push(...related.results.map(fromRow));
  }
  return { location, nearby: discoveries };
}

async function atlas(
  db: D1Database,
  params: URLSearchParams,
  admin = false,
): Promise<Response> {
  const [west, south, east, north] = parseBounds(params.get("bbox"));
  const zoomText = params.get("zoom");
  const zoom = zoomText === null ? 2 : Number(zoomText);
  if (zoomText === "" || !Number.isFinite(zoom) || zoom < 0 || zoom > 24)
    throw new HttpError(400, "zoom must be between 0 and 24.");
  const filter = buildFilters(params, admin);
  filter.where += ` AND l.coordinate_precision != 'withheld' AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL AND l.latitude BETWEEN ? AND ? AND ${west > east ? "(l.longitude >= ? OR l.longitude <= ?)" : "l.longitude BETWEEN ? AND ?"}`;
  filter.values.push(south, north, west, east);
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM locations l WHERE ${filter.where}`)
    .bind(...filter.values)
    .first<{ total: number }>();
  const total = count?.total ?? 0;
  if (!total)
    return (admin ? json : publicJson)({
      type: "FeatureCollection",
      features: [],
      total: 0,
    });
  let features: AtlasFeature[];
  const completePoints =
    params.get("format") === "points" &&
    !params.has("bbox") &&
    total <= ATLAS_COMPLETE_POINT_LIMIT;
  if (!completePoints && (zoom < 5 || total > 500)) {
    // At most 25 x 17 grid cells, even across the antimeridian. Aggregation
    // happens in SQLite; larger catalogs never produce an unbounded payload.
    const width = west > east ? 360 - west + east : east - west;
    const step = Math.max(
      360 / (2 ** Math.floor(zoom) * 8),
      width / 24,
      (north - south) / 16,
      0.000001,
    );
    const lngExpression =
      west > east
        ? `CASE WHEN l.longitude < ${west} THEN l.longitude + 360 ELSE l.longitude END`
        : "l.longitude";
    const rows = await db
      .prepare(
        `SELECT COUNT(*) AS count, MIN(l.id) AS id, MIN(l.slug) AS slug, MIN(l.name) AS name, MIN(l.category) AS category, AVG(${lngExpression}) AS longitude, AVG(l.latitude) AS latitude, CAST(((${lngExpression}) - ?) / ? AS INTEGER) AS cell_x, CAST((l.latitude - ?) / ? AS INTEGER) AS cell_y FROM locations l WHERE ${filter.where} GROUP BY cell_x, cell_y LIMIT 500`,
      )
      .bind(west, step, south, step, ...filter.values)
      .all<{
        count: number;
        id: string;
        slug: string;
        name: string;
        category: string;
        longitude: number;
        latitude: number;
        cell_x: number;
        cell_y: number;
      }>();
    features = rows.results.map((row) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          row.longitude > 180 ? row.longitude - 360 : row.longitude,
          row.latitude,
        ],
      },
      properties: {
        id: row.count === 1 ? row.id : `grid-${row.cell_x}-${row.cell_y}`,
        slug: row.count === 1 ? row.slug : "",
        name: row.count === 1 ? row.name : `${row.count} locations`,
        category: row.count === 1 ? row.category : "",
        count: row.count,
        clustered: row.count > 1,
      },
    }));
  } else {
    const rows = await db
      .prepare(
        `SELECT l.id,l.slug,l.name,l.category,l.longitude,l.latitude FROM locations l WHERE ${filter.where} ORDER BY l.id LIMIT ${completePoints ? ATLAS_COMPLETE_POINT_LIMIT : 500}`,
      )
      .bind(...filter.values)
      .all<{
        id: string;
        slug: string;
        name: string;
        category: string;
        longitude: number;
        latitude: number;
      }>();
    features = rows.results.map((row) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [row.longitude, row.latitude] },
      properties: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        category: row.category,
        count: 1,
        clustered: false,
      },
    }));
  }
  const result: AtlasGeoJSON = {
    type: "FeatureCollection",
    features,
    total,
    truncated: false,
  };
  return (admin ? json : publicJson)(result);
}

async function reviewMetadata(db: D1Database): Promise<Response> {
  const result = await db
    .prepare(
      `SELECT state, status, COUNT(*) AS total,
      SUM(CASE WHEN coordinate_precision != 'withheld' AND latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS mapped
     FROM locations GROUP BY state, status ORDER BY state, status`,
    )
    .all<{ state: string; status: string; total: number; mapped: number }>();
  return json({ groups: result.results });
}

async function metadata(db: D1Database): Promise<Response> {
  // Facets and total share one round trip and one consistent read.
  const data = await db
    .prepare(
      `SELECT 'category' AS kind, category AS value FROM locations WHERE status='published' GROUP BY category UNION ALL SELECT 'region', region FROM locations WHERE status='published' GROUP BY region UNION ALL SELECT 'classification', classification FROM locations WHERE status='published' GROUP BY classification UNION ALL SELECT 'phenomenon', p.phenomenon FROM location_phenomena p JOIN locations l ON l.id = p.location_id WHERE l.status='published' GROUP BY p.phenomenon UNION ALL SELECT 'total', CAST(COUNT(*) AS TEXT) FROM locations WHERE status='published'`,
    )
    .all<{ kind: string; value: string }>();
  const values = (kind: string) =>
    data.results
      .filter((item) => item.kind === kind)
      .map((item) => item.value)
      .sort();
  return publicJson({
    categories: values("category"),
    phenomena: values("phenomenon"),
    regions: values("region"),
    classifications: values("classification"),
    total: Number(
      data.results.find((item) => item.kind === "total")?.value ?? 0,
    ),
  });
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32)
    throw new HttpError(503, "Editorial access is not configured.");
  const token =
    request.headers.get("Authorization")?.match(/^Bearer (\S{1,512})$/)?.[1] ??
    "";
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_TOKEN)),
  ]);
  const actualBytes = new Uint8Array(actual),
    expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index++)
    difference |= actualBytes[index] ^ expectedBytes[index];
  if (difference !== 0)
    throw new HttpError(401, "Editorial authorization is required.");
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new HttpError(
        403,
        "Cross-origin editorial writes are not allowed.",
      );
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "Send application/json.");
  if (Number(request.headers.get("Content-Length")) > MAX_BODY)
    throw new HttpError(413, "Request body is too large.");
  if (!request.body) throw new HttpError(400, "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Malformed JSON.");
  }
}

async function saveLocation(
  request: Request,
  env: Env,
  id?: string,
): Promise<Response> {
  const location = validateLocation(await readJson(request));
  if (id && location.id !== id)
    throw new HttpError(400, "The URL and location id must match.");
  if (
    id &&
    !(await env.DB.prepare("SELECT id FROM locations WHERE id = ?")
      .bind(id)
      .first())
  )
    throw new HttpError(404, "Location not found.");
  const duplicate = await env.DB.prepare(
    "SELECT id FROM locations WHERE (slug = ? OR identity_key = ? OR id = ?) AND id != ?",
  )
    .bind(location.slug, identityKey(location), location.id, id ?? "")
    .first();
  if (duplicate)
    throw new HttpError(
      409,
      "A location with this identity, id, or slug already exists.",
    );
  location.updatedAt = new Date().toISOString();
  try {
    await env.DB.batch(
      locationStatements(location, Boolean(id)).map((statement) =>
        env.DB.prepare(statement.sql).bind(...statement.params),
      ),
    );
  } catch (error) {
    if (String(error).includes("UNIQUE constraint"))
      throw new HttpError(
        409,
        "A location with this identity, id, or slug already exists.",
      );
    throw error;
  }
  return json({ location }, id ? 200 : 201);
}

function siteUrl(env: Env): string {
  // Never construct canonical URLs from an untrusted Host header.
  const raw = env.SITE_URL || "http://localhost:5173";
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new HttpError(
      503,
      "The canonical site URL is not configured correctly.",
    );
  }
}

async function profileHtml(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  // The HTML article uses only this location, not the related-card results.
  // Cloudflare's HTML asset handling redirects /index.html to /. Fetch the
  // canonical root asset directly so metadata uses the complete HTML body.
  const [location, asset] = await Promise.all([
    getLocation(env.DB, slug),
    env.ASSETS.fetch(
      new Request(new URL("/", request.url), {
        headers: { Accept: "text/html" },
      }),
    ),
  ]);
  if (!location)
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Location not found — PHASM</title><body><main><h1>Location not found</h1><p>This location is unavailable or has not been published.</p><a href="/map">Explore the Haunted Atlas</a></main></body></html>',
      {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...publicHeaders,
        },
      },
    );
  const canonical = `${siteUrl(env)}/locations/${location.slug}`;
  const title = `${location.name} — Hauntings, History & Visiting Guide | PHASM`;
  const licenseUrl = imageLicenseUrl(
    location.imageLicense,
    location.imageSource,
  );
  const description = location.summary.slice(0, 200);
  const article = `<main class="server-profile">
    <a href="/">PHASM</a>
    <article>
      <h1>${escapeHtml(location.name)}</h1>
      <p>${escapeHtml([location.city, location.state, location.country].filter(Boolean).join(", "))}</p>
      <p>${escapeHtml(location.category)} · ${escapeHtml(location.classification)}</p>
      <section id="story"><h2>The Story</h2><p>${escapeHtml(location.summary)}</p></section>
      <section id="reports"><h2>The Hauntings</h2><p>${escapeHtml(location.reports)}</p></section>
      ${location.history ? `<section id="history"><h2>The History</h2><p>${escapeHtml(location.history)}</p></section>` : ""}
      <section id="gallery">
        <h2>A sense of place.</h2>
        <figure>
          <img src="${escapeHtml(location.image)}" alt="${escapeHtml(location.imageAlt)}" width="1200" height="675">
          <figcaption>${escapeHtml(location.imageCredit)} · ${licenseUrl ? `<a href="${escapeHtml(licenseUrl)}" rel="noopener noreferrer">${escapeHtml(location.imageLicense)}</a>` : escapeHtml(location.imageLicense)}${location.imageSource ? ` · <a href="${escapeHtml(location.imageSource)}" rel="noopener noreferrer">Image source</a>` : ""}</figcaption>
        </figure>
      </section>
      <section id="experiences">
        <h2>Visitor Experiences</h2>
        <h3>Have you experienced something here?</h3>
        <p>This future chapter will bring together stories from the PHASM community. An unexpected encounter, a lingering feeling, or a quiet visit—your experience will be welcome.</p>
        <p>Submissions are not open yet.</p>
      </section>
      <section id="sources">
        <h2>Sources &amp; further reading.</h2>
        <ul>${location.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a> (${source.kind})</li>`).join("")}</ul>
      </section>
      <section id="visit">
        <h2>Plan Your Visit</h2>
        <p>${escapeHtml(location.accessNotes)}</p>
        ${location.officialUrl ? `<p><a href="${escapeHtml(location.officialUrl)}" rel="noopener noreferrer">Official visitor information</a></p>` : ""}
      </section>
    </article>
    <a href="/map">Explore the atlas</a>
  </main>`;
  const origin = siteUrl(env);
  const state =
    location.country === "United States"
      ? findState(location.state)
      : undefined;
  const breadcrumbs = [
    { name: "PHASM", url: `${origin}/` },
    { name: "Haunted places", url: `${origin}/haunted-places` },
    ...(state
      ? [{ name: state.name, url: `${origin}/haunted-places/${state.slug}` }]
      : []),
    { name: location.name, url: canonical },
  ];
  const relatedDirectory = state
    ? `<p><a href="/haunted-places/${state.slug}">More haunted places in ${escapeHtml(state.name)}</a></p>`
    : '<p><a href="/haunted-places">Browse haunted places by state</a></p>';
  return htmlResponse(
    await asset.text(),
    {
      title,
      description,
      canonical,
      type: "article",
      ...(!location.image.split("?")[0].endsWith(".svg")
        ? { image: location.image, imageAlt: location.imageAlt }
        : {}),
      structuredData: [
        ...siteStructuredData(origin),
        locationStructuredData(location, origin),
        breadcrumbStructuredData(breadcrumbs),
      ],
    },
    article.replace("</article>", `${relatedDirectory}</article>`),
  );
}

function htmlResponse(
  template: string,
  metadata: PageMetadata,
  content: string,
  status = 200,
) {
  return new Response(renderPageHtml(template, metadata, content), {
    status,
    headers: {
      ...publicHeaders,
      "Cache-Control": "public, max-age=60",
      "Content-Type": "text/html; charset=utf-8",
      ...(metadata.noindex ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
    },
  });
}

async function htmlTemplate(request: Request, env: Env) {
  const asset = await env.ASSETS.fetch(
    new Request(new URL("/", request.url), {
      headers: { Accept: "text/html" },
    }),
  );
  if (!asset.ok)
    throw new HttpError(503, "The page template is temporarily unavailable.");
  return asset.text();
}

async function discovery(db: D1Database): Promise<DiscoveryResponse> {
  const rows = await db
    .prepare(
      "SELECT state, COUNT(*) AS count FROM locations WHERE status='published' AND country='United States' GROUP BY state",
    )
    .all<{ state: string; count: number }>();
  const counts = new Map(rows.results.map((row) => [row.state, row.count]));
  const states = US_STATES.map((state) => ({
    ...state,
    count: counts.get(state.name) || 0,
  }));
  return {
    states,
    total: states.reduce((total, state) => total + state.count, 0),
  };
}

function serverNavigation() {
  return '<nav aria-label="Main navigation"><a href="/">PHASM</a> · <a href="/map">Haunted Atlas</a> · <a href="/haunted-places">Haunted places by state</a> · <a href="/about">Our approach</a></nav>';
}

function locationList(locations: Location[]) {
  return `<ul>${locations.map((location) => `<li><article><h2><a href="/locations/${escapeHtml(location.slug)}">${escapeHtml(location.name)}</a></h2><p>${escapeHtml([location.city, location.state].filter(Boolean).join(", "))} · ${escapeHtml(location.category)}</p><p>${escapeHtml(location.summary)}</p></article></li>`).join("")}</ul>`;
}

async function directoryHtml(
  request: Request,
  env: Env,
  stateSlug?: string,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = siteUrl(env);
  const state = stateSlug ? findState(stateSlug) : undefined;
  if (stateSlug && (!state || state.slug !== stateSlug))
    return notFoundHtml(request, env);
  const rawPage = state ? url.searchParams.get("page") : null;
  if (
    rawPage !== null &&
    (!/^[1-9]\d*$/.test(rawPage) || Number(rawPage) > 100000)
  )
    return notFoundHtml(request, env);
  const page = Number(rawPage || 1);
  const [template, overview] = await Promise.all([
    htmlTemplate(request, env),
    discovery(env.DB),
  ]);
  const path = `/haunted-places${state ? `/${state.slug}` : ""}`;
  const canonical = `${origin}${path}${page > 1 ? `?page=${page}` : ""}`;
  const title = state
    ? `Haunted Places in ${state.name}${page > 1 ? ` — Page ${page}` : ""} | PHASM`
    : "Haunted Places by State | PHASM";
  const count = state
    ? overview.states.find((entry) => entry.code === state.code)!.count
    : overview.total;
  const pages = Math.max(1, Math.ceil(count / DIRECTORY_PAGE_SIZE));
  if (page > pages) return notFoundHtml(request, env);
  const description = state
    ? `Explore ${count.toLocaleString("en-US")} haunted places in ${state.name}. Read ghost stories, local history, source notes, and visiting information in the PHASM Haunted Atlas.`
    : "Explore haunted places in all 50 U.S. states. Find historic hotels, ghost towns, cemeteries, and local legends with stories, sources, and map pins.";
  let entries: { name: string; url: string }[];
  let content: string;
  if (state) {
    const result = await env.DB.prepare(
      "SELECT data_json FROM locations WHERE status='published' AND country='United States' AND state = ? ORDER BY featured DESC, name COLLATE NOCASE, id LIMIT ? OFFSET ?",
    )
      .bind(state.name, DIRECTORY_PAGE_SIZE, (page - 1) * DIRECTORY_PAGE_SIZE)
      .all<Row>();
    const locations = result.results.map(fromRow);
    entries = locations.map((location) => ({
      name: location.name,
      url: `${origin}/locations/${location.slug}`,
    }));
    const pageLink = (number: number) =>
      `${path}${number > 1 ? `?page=${number}` : ""}`;
    content = `<p><a href="/haunted-places">All states</a> / ${escapeHtml(state.name)}</p><h1>Haunted places in ${escapeHtml(state.name)}</h1><p>${escapeHtml(description)}</p><p><a href="/map?state=${state.code}">Explore ${escapeHtml(state.name)} on the map</a></p>${locationList(locations)}<nav aria-label="Directory pages">${page > 1 ? `<a rel="prev" href="${pageLink(page - 1)}">Previous page</a> · ` : ""}<span>Page ${page} of ${pages}</span>${page < pages ? ` · <a rel="next" href="${pageLink(page + 1)}">Next page</a>` : ""}</nav>`;
  } else {
    entries = overview.states.map((entry) => ({
      name: `Haunted places in ${entry.name}`,
      url: `${origin}/haunted-places/${entry.slug}`,
    }));
    content = `<h1>Haunted places by state</h1><p>${escapeHtml(description)}</p><p>${count.toLocaleString("en-US")} places across 50 states. Every place has a story. Some never rest.</p><ul>${overview.states.map((entry) => `<li><a href="/haunted-places/${entry.slug}">${escapeHtml(entry.name)}</a> — ${entry.count.toLocaleString("en-US")} places</li>`).join("")}</ul><p><a href="/map">Explore the Haunted Atlas</a></p>`;
  }
  return htmlResponse(
    template,
    {
      title,
      description,
      canonical,
      structuredData: [
        ...siteStructuredData(origin),
        collectionStructuredData(
          title,
          description,
          canonical,
          entries,
          (page - 1) * DIRECTORY_PAGE_SIZE,
        ),
        breadcrumbStructuredData([
          { name: "PHASM", url: `${origin}/` },
          { name: "Haunted places", url: `${origin}/haunted-places` },
          ...(state ? [{ name: state.name, url: `${origin}${path}` }] : []),
        ]),
      ],
    },
    `<main id="main" class="page-shell server-directory">${serverNavigation()}${content}</main>`,
  );
}

async function publicPageHtml(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const origin = siteUrl(env);
  const template = await htmlTemplate(request, env);
  let title: string;
  let description: string;
  let content: string;
  let extraStructured: unknown[] = [];
  if (path === "/" || path === "/map") {
    const [overview, result, international] = await Promise.all([
      discovery(env.DB),
      env.DB.prepare(
        "SELECT data_json FROM locations WHERE status='published' ORDER BY featured DESC, name COLLATE NOCASE, id LIMIT 10",
      ).all<Row>(),
      path === "/map"
        ? env.DB.prepare(
            "SELECT data_json FROM locations WHERE status='published' AND country != 'United States' ORDER BY name COLLATE NOCASE, id LIMIT 50",
          ).all<Row>()
        : Promise.resolve({ results: [] as Row[] }),
    ]);
    const locations = result.results.map(fromRow);
    const internationalLocations = international.results.map(fromRow);
    title =
      path === "/"
        ? "PHASM — Haunted Places, Ghost Stories & the Haunted Atlas"
        : "Haunted Places Map — The Haunted Atlas | PHASM";
    description =
      "Discover haunted places, ghost stories, and the history behind them. Explore the PHASM Haunted Atlas and browse researched places across all 50 U.S. states.";
    const directoryLinks = `<h2>Every state has its shadows.</h2><p>Find haunted hotels, forgotten landmarks, and local ghost stories across the United States.</p><p>${overview.total.toLocaleString("en-US")} places across 50 U.S. states.</p><p><a href="/haunted-places">Browse all 50 states</a></p><ul>${overview.states.map((state) => `<li><a href="/haunted-places/${state.slug}">Haunted places in ${state.name}</a></li>`).join("")}</ul>`;
    content =
      path === "/"
        ? `${homeHeroHtml()}<section class="section home-featured"><div class="home-section-heading"><div><div class="eyebrow"><span></span>Places that stay with you</div><h2>Step into the story.</h2></div><div class="home-section-intro"><p>Spirited hotels. Silent cellblocks. Ancient strongholds.<br class="desktop-break"> Find your next encounter with the unexplained.</p><a href="/map" class="text-link">Explore all places</a></div></div>${locationList(locations)}</section><section class="section home-state-gateway">${directoryLinks}</section>`
        : `<h1>The Haunted Atlas</h1><p>Explore haunted landmarks and local legends on an interactive map. Search by place, city, or region, and follow each pin to its history, ghost stories, and visiting information.</p><form action="/map" method="get"><label for="archive-search">Search a place, city or region</label><input id="archive-search" name="q" type="search"><button type="submit">Find haunted places</button></form><p><a href="/haunted-places">Browse haunted places by state</a></p><h2>Places that stay with you</h2>${locationList(locations)}${directoryLinks}${internationalLocations.length ? `<section><h2>Beyond the United States</h2><p>Follow the stories to haunted places around the world.</p>${locationList(internationalLocations)}</section>` : ""}`;
    if (path === "/map")
      extraStructured = [
        collectionStructuredData(
          title,
          description,
          `${origin}/map`,
          locations.map((location) => ({
            name: location.name,
            url: `${origin}/locations/${location.slug}`,
          })),
        ),
      ];
  } else if (path === "/about") {
    title = "About PHASM — Haunted Places, History & Our Approach";
    description =
      "How PHASM brings together haunted places, documented history, and local ghost lore, with sources, credited photographs, and respectful visiting information.";
    content =
      '<h1>There is more to the story.</h1><p>PHASM is for everyone drawn to haunted places, local legends, and the feeling that a place holds something more.</p><h2>Follow a haunting to its roots.</h2><p>Behind every haunted place are people, memories, and stories passed from one visitor to the next. We bring its history and ghost lore together, name the storytellers where we can, and link to the sources so you can follow your curiosity further.</p><h2>Three ways a place joins the atlas.</h2><h3>Established location</h3><p>A recognized haunted destination whose location and identity are documented in independent sources.</p><h3>Local legend</h3><p>A place kept alive in regional folklore or oral tradition, from a quiet country road to a familiar building with a story few outsiders know.</p><h3>Community discovery</h3><p>A place brought to PHASM by a visitor and reviewed by our editors before joining the atlas. Public suggestions are not open yet.</p><h2>Visit with respect.</h2><p>Never enter private property or restricted areas without permission. Follow the official visitor information, respect memorials and sensitive histories, and leave every place as you found it. Some map pins are approximate area references; check each profile before planning a visit.</p><p><a href="/haunted-places">Discover haunted places by state</a></p>';
  } else if (path === "/encyclopedia") {
    title = "Ghosts & Paranormal Phenomena — The PHASM Index";
    description =
      "Explore the language of ghost stories: apparitions, unexplained sounds, moving objects, unusual sensations, and mysterious lights and shadows.";
    const definitions = [
      [
        "Apparitions",
        "A figure in an empty doorway. A familiar face glimpsed for a moment. Apparition stories describe spirits taking visible form, from fleeting outlines to figures that seem as solid as anyone else in the room.",
      ],
      [
        "Unexplained sounds",
        "Footsteps along a deserted passage, a voice from an empty room, music heard after everyone has gone. Unexplained sounds are among the most enduring threads in haunted-place lore.",
      ],
      [
        "Objects moving",
        "Doors opening on their own, belongings found somewhere unexpected, or an object shifting in plain sight. Stories of restless objects are often woven into poltergeist lore and tales of mischievous spirits.",
      ],
      [
        "Unusual sensations",
        "The feeling of being watched. A sudden chill. The sense that someone has just entered an empty room. Some encounters are remembered for what a visitor felt, even when nothing was seen or heard.",
      ],
      [
        "Lights and shadows",
        "A light drifting across a dark landscape or a shadow passing at the edge of sight. Such glimpses run through ghost stories, from wandering lights outdoors to shadowy figures in quiet interiors.",
      ],
    ];
    content = `<h1>A language for the unexplained.</h1><p>Meet the apparitions, strange sounds, and fleeting sensations that weave their way through ghost stories. Follow a thread to the places where it lingers.</p>${definitions.map(([name, copy]) => `<section><h2>${name}</h2><p>${copy}</p><a href="/map?phenomenon=${encodeURIComponent(name)}">Explore related places</a></section>`).join("")}`;
  } else {
    const label =
      path === "/saved"
        ? "Your saved places"
        : path === "/account"
          ? "Your PHASM account"
          : "Case Files";
    title = `${label} — PHASM`;
    description =
      path === "/saved"
        ? "Your saved haunted places, stored privately in this browser."
        : "A future chapter of the PHASM Haunted Atlas.";
    content = `<h1>${label}</h1><p>${description}</p><p><a href="/map">Explore the Haunted Atlas</a></p>`;
  }
  return htmlResponse(
    template,
    {
      title,
      description,
      canonical: `${origin}${path}`,
      noindex: ["/saved", "/account", "/cases"].includes(path),
      structuredData: [...siteStructuredData(origin), ...extraStructured],
    },
    path === "/"
      ? `${homeHeaderHtml()}<main id="main" class="home-page">${content}</main>`
      : `<main id="main" class="page-shell server-page">${serverNavigation()}${content}</main>`,
  );
}

async function notFoundHtml(request: Request, env: Env): Promise<Response> {
  return htmlResponse(
    await htmlTemplate(request, env),
    {
      title: "Page not found — PHASM",
      description:
        "This page is not in the PHASM archive. Explore the Haunted Atlas to find a place with a story.",
      canonical: `${siteUrl(env)}${new URL(request.url).pathname}`,
      noindex: true,
    },
    '<main id="main" class="page-shell"><h1>This path has gone quiet.</h1><p>The page you’re looking for isn’t in the archive.</p><a href="/haunted-places">Browse haunted places</a></main>',
    404,
  );
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path.startsWith("/api/admin")) {
    await requireAdmin(request, env);
    if (
      env.EDITORIAL_READ_ONLY === "true" &&
      !["GET", "HEAD"].includes(request.method)
    )
      throw new HttpError(
        403,
        "This preview is read-only. Use the repeatable import workflow for changes.",
      );
    if (request.method === "GET") {
      if (path === "/api/admin/review/locations")
        return listLocations(env.DB, url.searchParams, true, true);
      if (path === "/api/admin/review/atlas")
        return atlas(env.DB, url.searchParams, true);
      if (path === "/api/admin/review/meta") return reviewMetadata(env.DB);
      const reviewSlug = path.match(
        /^\/api\/admin\/review\/locations\/([a-z0-9-]+)$/,
      )?.[1];
      if (reviewSlug) {
        const row = await env.DB.prepare(
          "SELECT data_json FROM locations WHERE slug = ?",
        )
          .bind(reviewSlug)
          .first<Row>();
        if (!row) throw new HttpError(404, "Location not found.");
        return json({ location: fromRow(row) });
      }
    }
    if (path === "/api/admin/locations" && request.method === "GET")
      return listLocations(env.DB, url.searchParams, true);
    if (path === "/api/admin/locations" && request.method === "POST")
      return saveLocation(request, env);
    const id = path.match(/^\/api\/admin\/locations\/([a-zA-Z0-9_-]+)$/)?.[1];
    if (id && request.method === "PUT") return saveLocation(request, env, id);
    throw new HttpError(404, "Editorial endpoint not found.");
  }
  if (
    path.startsWith("/api/") &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    if (/^\/api\/(reviews|submissions|suggestions|uploads)(\/|$)/.test(path))
      throw new HttpError(403, "Community submissions are not enabled.");
    throw new HttpError(405, "Method not allowed.");
  }
  if (path === "/api/locations") return listLocations(env.DB, url.searchParams);
  if (path === "/api/atlas") return atlas(env.DB, url.searchParams);
  if (path === "/api/meta") return metadata(env.DB);
  if (path === "/api/discover") return publicJson(await discovery(env.DB));
  const slug = path.match(/^\/api\/locations\/([a-z0-9-]+)$/)?.[1];
  if (slug) {
    if (url.searchParams.get("format") === "summary") {
      const location = await getLocation(env.DB, slug);
      if (!location) throw new HttpError(404, "Location not found.");
      return publicJson({ location: summary(location) });
    }
    const profile = await getProfile(env.DB, slug);
    if (!profile) throw new HttpError(404, "Location not found.");
    return publicJson(profile);
  }
  if (path.startsWith("/api/")) throw new HttpError(404, "Endpoint not found.");
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed.");
  if (path === "/sitemap.xml") {
    const rows = await env.DB.prepare(
      "SELECT slug, updated_at FROM locations WHERE status='published' ORDER BY slug LIMIT 45000",
    ).all<{ slug: string; updated_at: string }>();
    const origin = siteUrl(env);
    const overview = await discovery(env.DB);
    const pages = ["/", "/map", "/haunted-places", "/about", "/encyclopedia"];
    for (const state of overview.states) {
      if (!state.count) continue;
      const totalPages = Math.ceil(state.count / DIRECTORY_PAGE_SIZE);
      for (let page = 1; page <= totalPages; page++)
        pages.push(
          `/haunted-places/${state.slug}${page > 1 ? `?page=${page}` : ""}`,
        );
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>${escapeHtml(origin + page)}</loc></url>`).join("")}${rows.results.map((row) => `<url><loc>${escapeHtml(`${origin}/locations/${row.slug}`)}</loc><lastmod>${escapeHtml(row.updated_at)}</lastmod></url>`).join("")}</urlset>`;
    return new Response(body, {
      headers: {
        ...publicHeaders,
        "Content-Type": "application/xml; charset=utf-8",
      },
    });
  }
  if (path === "/robots.txt")
    return new Response(
      `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteUrl(env)}/sitemap.xml\n`,
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...publicHeaders,
        },
      },
    );
  const publicPage = [
    "/",
    "/map",
    "/haunted-places",
    "/about",
    "/encyclopedia",
    "/saved",
    "/account",
    "/cases",
  ].includes(path);
  const stateSlug = path.match(/^\/haunted-places\/([a-z-]+)$/)?.[1];
  const profileSlug = path.match(/^\/locations\/([a-z0-9-]+)$/)?.[1];
  if ((publicPage || stateSlug || profileSlug) && url.pathname !== path) {
    const canonical = new URL(`${siteUrl(env)}${path}`);
    canonical.search = url.search;
    return Response.redirect(canonical.href, 308);
  }
  if (profileSlug) return profileHtml(request, env, profileSlug);
  if (path === "/haunted-places" || stateSlug)
    return directoryHtml(request, env, stateSlug);
  if (publicPage) return publicPageHtml(request, env, path);
  if (path === "/index.html") return Response.redirect(`${siteUrl(env)}/`, 308);
  // Known static assets and the private local editorial app still use ASSETS.
  // Unknown HTML routes must return 404 instead of an indexable SPA soft-404.
  if (
    /^\/(?:assets|images)\//.test(path) ||
    /\.[a-z0-9]+$/i.test(path) ||
    /^\/admin(?:\/|$)/.test(path)
  ) {
    const asset = await env.ASSETS.fetch(request);
    if (
      !/^\/admin(?:\/|$)/.test(path) &&
      asset.headers.get("Content-Type")?.includes("text/html")
    )
      return notFoundHtml(request, env);
    return asset;
  }
  return notFoundHtml(request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError)
        response = json({ error: error.message }, error.status);
      else {
        console.error(
          "PHASM request failed",
          error instanceof Error ? error.message : "Unknown failure",
        );
        response = json(
          {
            error:
              "The archive is temporarily unavailable. Please try again shortly.",
          },
          503,
        );
      }
    }
    const secured = new Response(
      request.method === "HEAD" ? null : response.body,
      response,
    );
    for (const [name, value] of Object.entries(securityHeaders))
      secured.headers.set(name, value);
    if (
      new URL(request.url).pathname.startsWith("/api/") &&
      (request.headers.has("Authorization") || request.headers.has("Cookie"))
    )
      secured.headers.set("Cache-Control", "no-store");
    if (
      secured.status >= 400 ||
      /^\/(?:api|admin|account|saved|cases)(?:\/|$)/.test(
        new URL(request.url).pathname,
      )
    )
      secured.headers.set("X-Robots-Tag", "noindex, nofollow");
    return secured;
  },
};
