import type { AtlasGeoJSON } from "../shared/types";

export type AtlasBounds = [number, number, number, number];
export type AtlasViewport = { bounds: AtlasBounds; zoom: number };
type FeedState = "loading" | "complete" | "viewport" | "error";

/** Normalize wrapped map bounds without turning a world view into a zero-width box. */
export function atlasBounds(
  west: number,
  south: number,
  east: number,
  north: number,
): AtlasBounds {
  if (east - west >= 360) {
    west = -180;
    east = 180;
  } else {
    const wrap = (longitude: number) =>
      ((((longitude + 180) % 360) + 360) % 360) - 180;
    west = wrap(west);
    east = wrap(east);
  }
  return [west, Math.max(-85.051129, south), east, Math.min(85.051129, north)];
}

export function atlasPath(query: string, viewport?: AtlasViewport) {
  const params = new URLSearchParams(query);
  params.delete("page");
  params.delete("pageSize");
  params.delete("view");
  params.delete("bbox");
  params.set("zoom", String(viewport ? Math.round(viewport.zoom) : 5));
  if (viewport) params.set("bbox", viewport.bounds.join(","));
  return `/api/atlas?${params}`;
}

/** The API may aggregate larger catalogs even at zoom 5. Never treat that as all pins. */
export function completeAtlasFeed(data: AtlasGeoJSON) {
  return (
    !data.truncated &&
    data.total <= 500 &&
    data.features.length === data.total &&
    data.features.every(
      ({ properties }) =>
        !properties.clustered && (properties.count ?? 1) === 1,
    )
  );
}

export function countAtlasInBounds(data: AtlasGeoJSON, bounds: AtlasBounds) {
  const [west, south, east, north] = bounds;
  return data.features.reduce((total, feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const insideLongitude =
      west > east
        ? longitude >= west || longitude <= east
        : longitude >= west && longitude <= east;
    return (
      total +
      (insideLongitude && latitude >= south && latitude <= north ? 1 : 0)
    );
  }, 0);
}

type FeedCallbacks = {
  viewport: () => AtlasViewport;
  isCurrent: (query: string) => boolean;
  loading: (filterChanged: boolean) => void;
  /** Return true when a filter change starts a camera fit; its moveend fetches the viewport. */
  data: (data: AtlasGeoJSON, filterChanged: boolean) => boolean;
  count: (total: number) => void;
  error: () => void;
};

/** Owns requests, including the bounded fallback, independently of React and MapLibre. */
export class AtlasFeed {
  private query = "";
  private generation = 0;
  private disposed = false;
  private state: FeedState = "loading";
  private controller?: AbortController;
  private complete?: AtlasGeoJSON;
  private viewportKey = "";

  constructor(
    private fetchData: (
      path: string,
      signal: AbortSignal,
    ) => Promise<AtlasGeoJSON>,
    private callbacks: FeedCallbacks,
  ) {}

  async load(query: string) {
    if (this.disposed) return;
    this.controller?.abort();
    this.query = query;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.state = "loading";
    this.complete = undefined;
    this.viewportKey = "";
    this.callbacks.loading(true);
    try {
      const data = await this.fetchData(atlasPath(query), controller.signal);
      if (!this.current(generation, controller)) return;
      const complete = completeAtlasFeed(data);
      this.complete = complete ? data : undefined;
      this.state = complete ? "complete" : "viewport";
      const fitted = this.callbacks.data(data, true);
      if (complete) this.updateCount();
      else if (!fitted) await this.move();
    } catch {
      if (!this.current(generation, controller)) return;
      this.state = "error";
      this.callbacks.error();
    }
  }

  async move() {
    if (this.disposed || !this.callbacks.isCurrent(this.query)) return;
    if (this.state === "complete") {
      this.updateCount();
      return;
    }
    if (this.state === "error") {
      await this.load(this.query);
      return;
    }
    if (this.state !== "viewport") return;
    const path = atlasPath(this.query, this.callbacks.viewport());
    // Also deduplicates identical in-flight requests from consecutive map events.
    if (path === this.viewportKey) return;
    this.viewportKey = path;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    this.callbacks.loading(false);
    try {
      const data = await this.fetchData(path, controller.signal);
      if (!this.current(generation, controller)) return;
      this.callbacks.data(data, false);
      this.callbacks.count(data.total);
    } catch {
      if (!this.current(generation, controller)) return;
      this.viewportKey = "";
      this.callbacks.error();
    }
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
  }

  private current(generation: number, controller: AbortController) {
    return (
      !this.disposed &&
      !controller.signal.aborted &&
      this.generation === generation &&
      this.controller === controller &&
      this.callbacks.isCurrent(this.query)
    );
  }

  private updateCount() {
    if (this.complete)
      this.callbacks.count(
        countAtlasInBounds(this.complete, this.callbacks.viewport().bounds),
      );
  }
}
