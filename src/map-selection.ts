export interface MapChoice {
  slug: string;
  name: string;
  category: string;
  coordinates: [number, number];
}

type RenderedFeature = {
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
};

/** Tile boundaries can return a marker twice. Keep every distinct profile at
 * the pointer, without moving markers away from their sourced coordinates. */
export function overlappingMapChoices(
  features: readonly RenderedFeature[],
): MapChoice[] {
  const choices = new Map<string, MapChoice>();
  for (const feature of features) {
    const props = feature.properties;
    const point = feature.geometry.coordinates;
    if (
      !props ||
      props.clustered ||
      props.point_count !== undefined ||
      typeof props.slug !== "string" ||
      !props.slug ||
      typeof props.name !== "string" ||
      feature.geometry.type !== "Point" ||
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every(
        (coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
      )
    )
      continue;
    choices.set(props.slug, {
      slug: props.slug,
      name: props.name,
      category: typeof props.category === "string" ? props.category : "",
      coordinates: [point[0], point[1]],
    });
  }
  return [...choices.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug),
  );
}
