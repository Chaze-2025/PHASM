import type { AtlasFeature, AtlasGeoJSON, Location } from "../shared/types";
import {
  HttpError,
  identityKey,
  integerParam,
  parseBounds,
  validateLocation,
} from "./validation";
import { locationStatements } from "./location-sql";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
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
function fromRow(row: Row): Location {
  return JSON.parse(row.data_json) as Location;
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
  return { where: parts.join(" AND "), values };
}

async function listLocations(
  db: D1Database,
  params: URLSearchParams,
  admin = false,
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
  return json({
    locations: result.results.map(fromRow),
    total: count?.total ?? 0,
    page,
    pageSize,
  });
}

async function getProfile(
  db: D1Database,
  slug: string,
): Promise<{ location: Location; nearby: Location[] } | null> {
  const row = await db
    .prepare(
      "SELECT data_json FROM locations WHERE slug = ? AND status = 'published'",
    )
    .bind(slug)
    .first<Row>();
  if (!row) return null;
  const location = fromRow(row);
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
  const discoveries = nearby.results.map(fromRow);
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
): Promise<Response> {
  const [west, south, east, north] = parseBounds(params.get("bbox"));
  const zoomText = params.get("zoom");
  const zoom = zoomText === null ? 2 : Number(zoomText);
  if (zoomText === "" || !Number.isFinite(zoom) || zoom < 0 || zoom > 24)
    throw new HttpError(400, "zoom must be between 0 and 24.");
  const filter = buildFilters(params);
  filter.where += ` AND l.latitude BETWEEN ? AND ? AND ${west > east ? "(l.longitude >= ? OR l.longitude <= ?)" : "l.longitude BETWEEN ? AND ?"}`;
  filter.values.push(south, north, west, east);
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM locations l WHERE ${filter.where}`)
    .bind(...filter.values)
    .first<{ total: number }>();
  const total = count?.total ?? 0;
  if (!total)
    return json({ type: "FeatureCollection", features: [], total: 0 });
  let features: AtlasFeature[];
  if (zoom < 5 || total > 500) {
    // At most 25 x 17 grid cells, even across the antimeridian. Aggregation
    // happens in SQLite; the Worker never downloads the complete catalog.
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
        `SELECT l.id,l.slug,l.name,l.category,l.longitude,l.latitude FROM locations l WHERE ${filter.where} ORDER BY l.id LIMIT 500`,
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
  return json(result);
}

async function metadata(db: D1Database): Promise<Response> {
  // One statement keeps requests below D1's free-plan query budget.
  const data = await db
    .prepare(
      `SELECT 'category' AS kind, category AS value FROM locations WHERE status='published' GROUP BY category UNION ALL SELECT 'region', region FROM locations WHERE status='published' GROUP BY region UNION ALL SELECT 'classification', classification FROM locations WHERE status='published' GROUP BY classification UNION ALL SELECT 'phenomenon', p.phenomenon FROM location_phenomena p JOIN locations l ON l.id = p.location_id WHERE l.status='published' GROUP BY p.phenomenon`,
    )
    .all<{ kind: string; value: string }>();
  const total = await db
    .prepare("SELECT COUNT(*) AS total FROM locations WHERE status='published'")
    .first<{ total: number }>();
  const values = (kind: string) =>
    data.results
      .filter((item) => item.kind === kind)
      .map((item) => item.value)
      .sort();
  return json({
    categories: values("category"),
    phenomena: values("phenomenon"),
    regions: values("region"),
    classifications: values("classification"),
    total: total?.total ?? 0,
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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
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
  const profile = await getProfile(env.DB, slug);
  // Cloudflare's HTML asset handling redirects /index.html to /. Fetch the
  // canonical root asset directly so the rewriter receives the HTML body.
  const asset = await env.ASSETS.fetch(
    new Request(new URL("/", request.url), { headers: { Accept: "text/html" } }),
  );
  if (!profile)
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
  const { location } = profile;
  const canonical = `${siteUrl(env)}/locations/${location.slug}`;
  const image = new URL(location.image, siteUrl(env)).href;
  const title = `${location.name} — Haunted places in ${location.city || location.country} | PHASM`;
  const description = location.summary.slice(0, 200);
  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Place",
    name: location.name,
    description,
    url: canonical,
    image,
    address: {
      "@type": "PostalAddress",
      addressLocality: location.city,
      addressRegion: location.state,
      addressCountry: location.country,
    },
    ...(location.coordinatePrecision === "exact"
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: location.latitude,
            longitude: location.longitude,
          },
        }
      : {}),
    ...(location.officialUrl ? { sameAs: location.officialUrl } : {}),
  }).replace(/</g, "\\u003c");
  const head = `<link rel="canonical" href="${escapeHtml(canonical)}"><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="place"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${structured}</script>`;
  const article = `<main class="server-profile"><a href="/">PHASM</a><article><h1>${escapeHtml(location.name)}</h1><p>${escapeHtml([location.city, location.state, location.country].filter(Boolean).join(", "))}</p><p>${escapeHtml(location.category)} · ${escapeHtml(location.classification)}</p><figure><img src="${escapeHtml(location.image)}" alt="${escapeHtml(location.imageAlt)}" width="1200" height="675"><figcaption>${escapeHtml(location.imageCredit)} · ${location.imageLicense === "CC BY-SA 4.0" ? '<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener noreferrer">CC BY-SA 4.0</a>' : escapeHtml(location.imageLicense)}${location.imageSource ? ` · <a href="${escapeHtml(location.imageSource)}" rel="noopener noreferrer">Image source</a>` : ""}</figcaption></figure><p>${escapeHtml(location.summary)}</p><h2>Historical overview</h2><p>${escapeHtml(location.history)}</p><h2>Reported paranormal activity</h2><p>Reported experiences and local traditions are not verified supernatural evidence.</p><p>${escapeHtml(location.reports)}</p><h2>Visiting information</h2><p>${escapeHtml(location.accessNotes)}</p>${location.officialUrl ? `<p><a href="${escapeHtml(location.officialUrl)}" rel="noopener noreferrer">Official visiting website</a></p>` : ""}<h2>Sources</h2><ul>${location.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a> (${source.kind})</li>`).join("")}</ul><h2>Community experiences</h2><p>Community submissions are planned. No visitor reviews have been collected.</p></article><a href="/map">Explore the atlas</a></main>`;
  // A dynamic profile must not reuse the static template's conditional
  // request headers or ETag; normalize its content type before rewriting.
  const htmlSource = new Response(await asset.text(), {
    headers: { "Content-Type": "text/html" },
  });
  const transformed = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(escapeHtml(title), { html: true });
      },
    })
    .on(
      'meta[name="description"],meta[property^="og:"],meta[name="twitter:card"],link[rel="canonical"]',
      {
        element(element) {
          element.remove();
        },
      },
    )
    .on("head", {
      element(element) {
        element.append(head, { html: true });
      },
    })
    .on("#root", {
      element(element) {
        element.setInnerContent(article, { html: true });
      },
    })
    .transform(htmlSource);
  const headers = new Headers(transformed.headers);
  for (const [name, value] of Object.entries(publicHeaders)) headers.set(name, value);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(transformed.body, { status: 200, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path.startsWith("/api/admin")) {
    await requireAdmin(request, env);
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
  const slug = path.match(/^\/api\/locations\/([a-z0-9-]+)$/)?.[1];
  if (slug) {
    const profile = await getProfile(env.DB, slug);
    if (!profile) throw new HttpError(404, "Location not found.");
    return json(profile);
  }
  if (path.startsWith("/api/")) throw new HttpError(404, "Endpoint not found.");
  if (request.method !== "GET" && request.method !== "HEAD")
    throw new HttpError(405, "Method not allowed.");
  if (path === "/sitemap.xml") {
    const rows = await env.DB.prepare(
      "SELECT slug, updated_at FROM locations WHERE status='published' ORDER BY slug LIMIT 45000",
    ).all<{ slug: string; updated_at: string }>();
    const origin = siteUrl(env);
    const pages = ["/", "/map", "/about", "/encyclopedia"];
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
  const profileSlug = path.match(/^\/locations\/([a-z0-9-]+)$/)?.[1];
  if (profileSlug) return profileHtml(request, env, profileSlug);
  return env.ASSETS.fetch(request);
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
    if (/^\/(?:api\/)?admin(?:\/|$)/.test(new URL(request.url).pathname))
      secured.headers.set("X-Robots-Tag", "noindex, nofollow");
    return secured;
  },
};
