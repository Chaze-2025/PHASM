import type { Location } from "../shared/types";
import { identityKey } from "./validation";

export interface SqlStatement {
  sql: string;
  params: (string | number)[];
}
const columns = [
  "id",
  "slug",
  "identity_key",
  "name",
  "city",
  "state",
  "country",
  "region",
  "latitude",
  "longitude",
  "category",
  "classification",
  "access",
  "tours",
  "status",
  "coordinate_precision",
  "featured",
  "updated_at",
  "data_json",
];

export function locationStatements(
  location: Location,
  update = false,
): SqlStatement[] {
  const values = [
    location.id,
    location.slug,
    identityKey(location),
    location.name,
    location.city,
    location.state,
    location.country,
    location.region,
    location.latitude,
    location.longitude,
    location.category,
    location.classification,
    location.access,
    location.tours,
    location.status,
    location.coordinatePrecision,
    Number(location.featured),
    location.updatedAt,
    JSON.stringify(location),
  ];
  const statements: SqlStatement[] = [
    {
      sql: update
        ? `UPDATE locations SET ${columns
            .slice(1)
            .map((column) => `${column} = ?`)
            .join(", ")} WHERE id = ?`
        : `INSERT INTO locations (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      params: update ? [...values.slice(1), location.id] : values,
    },
  ];
  if (update)
    statements.push(
      {
        sql: "DELETE FROM location_phenomena WHERE location_id = ?",
        params: [location.id],
      },
      {
        sql: "DELETE FROM location_sources WHERE location_id = ?",
        params: [location.id],
      },
    );
  if (location.phenomena.length)
    statements.push({
      sql: `INSERT INTO location_phenomena (location_id, phenomenon) VALUES ${location.phenomena.map(() => "(?, ?)").join(", ")}`,
      params: location.phenomena.flatMap((tag) => [location.id, tag]),
    });
  // D1 caps each statement at 100 bound values; 24 source rows use 96.
  for (let offset = 0; offset < location.sources.length; offset += 24) {
    const sources = location.sources.slice(offset, offset + 24);
    statements.push({
      sql: `INSERT OR IGNORE INTO location_sources (location_id, title, url, kind) VALUES ${sources.map(() => "(?, ?, ?, ?)").join(", ")}`,
      params: sources.flatMap((source) => [
        location.id,
        source.title,
        source.url,
        source.kind,
      ]),
    });
  }
  statements.push({
    sql: "INSERT INTO editorial_audit (location_id, action) VALUES (?, ?)",
    params: [
      location.id,
      update ? `updated:${location.status}` : `created:${location.status}`,
    ],
  });
  return statements;
}
