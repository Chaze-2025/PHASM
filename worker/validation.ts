import type { Location, Source } from "../shared/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const enums = {
  classification: ["established", "local-legend", "community-discovery"],
  access: ["public", "restricted", "private", "unknown"],
  tours: ["yes", "no", "unknown"],
  status: ["draft", "published", "archived"],
  coordinatePrecision: ["exact", "approximate", "withheld"],
} as const;

function string(
  value: unknown,
  label: string,
  max: number,
  required = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new HttpError(
      400,
      `${label} must be ${required ? "a non-empty " : "a "}string of at most ${max} characters.`,
    );
  }
  return value.trim();
}

function enumValue<T extends string>(
  value: unknown,
  label: string,
  values: readonly T[],
): T {
  if (!values.includes(value as T))
    throw new HttpError(400, `Invalid ${label}.`);
  return value as T;
}

export function safeUrl(
  value: unknown,
  label: string,
  allowLocal = false,
  required = false,
  allowHttp = false,
): string {
  const text = string(value, label, 2048, required);
  if (!text) return "";
  if (
    allowLocal &&
    /^\/(?!\/)[a-zA-Z0-9/_.,@%+-]+$/.test(text) &&
    !text.includes("..")
  )
    return text;
  try {
    const url = new URL(text);
    if (
      (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.href;
  } catch {
    throw new HttpError(
      400,
      `${label} must be an ${allowHttp ? "HTTP or HTTPS" : "HTTPS"} URL${allowLocal ? " or a local asset path" : ""}.`,
    );
  }
}

export function identityKey(
  location: Pick<Location, "name" | "city" | "state" | "country">,
): string {
  return [location.name, location.city, location.state, location.country]
    .map((value) =>
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .join("|");
}

export function validateLocation(input: unknown): Location {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "A location object is required.");
  const data = input as Record<string, unknown>;
  const id = string(data.id, "id", 100);
  const slug = string(data.slug, "slug", 140);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^[a-zA-Z0-9_-]+$/.test(id))
    throw new HttpError(400, "Invalid id or slug.");
  const latitude = data.latitude;
  const longitude = data.longitude;
  const coordinatePrecision = enumValue(
    data.coordinatePrecision,
    "coordinate precision",
    enums.coordinatePrecision,
  );
  if (coordinatePrecision === "withheld") {
    if (latitude !== null || longitude !== null)
      throw new HttpError(
        400,
        "Withheld coordinates require both latitude and longitude to be null.",
      );
  } else if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new HttpError(
      400,
      "Coordinates must be finite numbers in geographic bounds.",
    );
  const access = enumValue(data.access, "access", enums.access);
  if (access === "private" && coordinatePrecision === "exact")
    throw new HttpError(
      400,
      "Private sites require withheld or privacy-safe approximate coordinates.",
    );
  if (
    access === "private" &&
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    (Math.abs(latitude * 10 - Math.round(latitude * 10)) > 0.00001 ||
      Math.abs(longitude * 10 - Math.round(longitude * 10)) > 0.00001)
  )
    throw new HttpError(
      400,
      "Private-site coordinates must be rounded to one decimal degree or coarser.",
    );
  if (!Array.isArray(data.phenomena) || data.phenomena.length > 20)
    throw new HttpError(400, "Provide at most 20 phenomenon tags.");
  const phenomena = [
    ...new Set(data.phenomena.map((value) => string(value, "phenomenon", 100))),
  ];
  if (!Array.isArray(data.sources) || data.sources.length > 30)
    throw new HttpError(400, "Provide at most 30 sources.");
  const sources: Source[] = data.sources.map((entry: unknown) => {
    if (!entry || typeof entry !== "object")
      throw new HttpError(400, "Invalid source.");
    const source = entry as Record<string, unknown>;
    return {
      title: string(source.title, "source title", 250),
      url: safeUrl(source.url, "source URL", false, true, true),
      kind: enumValue(source.kind, "source kind", [
        "history",
        "reports",
        "visiting",
      ] as const),
    };
  });
  const status = enumValue(data.status, "status", enums.status);
  const history = string(data.history, "history", 30000, false);
  const reports = string(
    data.reports,
    "reports",
    20000,
    status === "published",
  );
  if (
    status === "published" &&
    ((history && !sources.some((source) => source.kind === "history")) ||
      !sources.some((source) => source.kind === "reports"))
  )
    throw new HttpError(
      400,
      "Published locations require paranormal-report sources and a history source when historical copy is provided.",
    );
  if (typeof data.featured !== "boolean")
    throw new HttpError(400, "featured must be a boolean.");
  const location: Location = {
    id,
    slug,
    name: string(data.name, "name", 200),
    city: string(data.city, "city", 150, false),
    state: string(data.state, "state", 150, false),
    country: string(data.country, "country", 150),
    region: string(data.region, "region", 150),
    latitude: latitude as number | null,
    longitude: longitude as number | null,
    category: string(data.category, "category", 100),
    classification: enumValue(
      data.classification,
      "classification",
      enums.classification,
    ),
    summary: string(data.summary, "summary", 1000),
    history,
    reports,
    phenomena,
    access,
    tours: enumValue(data.tours, "tour availability", enums.tours),
    accessNotes: string(data.accessNotes, "access notes", 5000),
    officialUrl: safeUrl(data.officialUrl, "official URL", false, false, true),
    sources,
    image: safeUrl(data.image, "image URL", true, true),
    imageAlt: string(data.imageAlt, "image alt", 500),
    imageCredit: string(data.imageCredit, "image credit", 500),
    imageLicense: string(data.imageLicense, "image license", 500),
    imageSource: safeUrl(data.imageSource, "image source", true),
    status,
    coordinatePrecision,
    featured: data.featured,
    updatedAt: string(data.updatedAt, "updatedAt", 40),
  };
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z)?$/.test(location.updatedAt) ||
    !Number.isFinite(Date.parse(location.updatedAt))
  )
    throw new HttpError(400, "updatedAt must be an ISO date.");
  return location;
}

export function parseBounds(
  value: string | null,
): [number, number, number, number] {
  if (value === null) return [-180, -85.051129, 180, 85.051129];
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => !part.trim()))
    throw new HttpError(400, "bbox must contain west,south,east,north.");
  const [west, south, east, north] = parts.map(Number);
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    Math.abs(west) > 180 ||
    Math.abs(east) > 180 ||
    Math.abs(south) > 90 ||
    Math.abs(north) > 90 ||
    south >= north ||
    west === east
  )
    throw new HttpError(400, "Invalid geographic bounding box.");
  return [west, south, east, north];
}

export function integerParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value))
    throw new HttpError(
      400,
      "Pagination parameters must be positive integers.",
    );
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min)
    throw new HttpError(400, "Invalid pagination parameter.");
  return Math.min(max, result);
}
