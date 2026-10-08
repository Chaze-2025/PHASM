import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import { type Map as MapInstance, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Search,
  SlidersHorizontal,
  X,
  List,
  Map as MapIcon,
  MapPin,
  ArrowUpRight,
  Compass,
  RotateCcw,
} from "lucide-react";
import type { FeatureCollection, Point } from "geojson";
import { api, useApi } from "./api";
import {
  categories,
  phenomena,
  type AtlasGeoJSON,
  type Location,
  type LocationPage,
} from "../shared/types";
import { LocationCard, PlaceImage, Status, SaveButton } from "./components";
const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/dark";
function MapCanvas({
  query,
  locations,
  onSelect,
}: {
  query: string;
  locations: Location[];
  onSelect: (slug: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const queryRef = useRef(query);
  const selectRef = useRef(onSelect);
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Loading the atlas…");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  queryRef.current = query;
  selectRef.current = onSelect;
  const refresh = useCallback(async () => {
    const m = map.current;
    if (!m || !m.getSource("locations")) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const bounds = m.getBounds();
    let west = bounds.getWest(),
      east = bounds.getEast();
    if (east - west >= 360) {
      west = -180;
      east = 180;
    } else {
      west = ((((west + 180) % 360) + 360) % 360) - 180;
      east = ((((east + 180) % 360) + 360) % 360) - 180;
    }
    const bbox = [
      west,
      Math.max(-85, bounds.getSouth()),
      east,
      Math.min(85, bounds.getNorth()),
    ].join(",");
    setStatus("Updating places…");
    try {
      const data = await api<AtlasGeoJSON>(
        `/api/atlas?${queryRef.current}&bbox=${bbox}&zoom=${Math.round(m.getZoom())}`,
        { signal: next.signal },
      );
      (m.getSource("locations") as GeoJSONSource)?.setData(
        data as FeatureCollection,
      );
      setStatus(
        data.total
          ? `${data.total} ${data.total === 1 ? "place" : "places"} in this area`
          : "No published places in this area",
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setStatus("Places could not load. Move the map to retry.");
    }
  }, []);
  useEffect(() => {
    if (!container.current) return;
    let m: MapInstance;
    let resizeObserver: ResizeObserver | undefined;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        center: [-28, 34],
        zoom: 1.65,
        minZoom: 1,
        maxZoom: 18,
        attributionControl: { compact: true },
        renderWorldCopies: false,
      });
      map.current = m;
      resizeObserver = new ResizeObserver(() => m.resize());
      resizeObserver.observe(container.current);
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "bottom-right",
      );
      m.addControl(
        new maplibregl.ScaleControl({ maxWidth: 100 }),
        "bottom-left",
      );
      m.on("error", () => {
        setFailed(true);
        setStatus("The basemap is unavailable. You can still browse the list.");
      });
      m.on("load", () => {
        setReady(true);
        setFailed(false);
        m.addSource("locations", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 12,
          clusterRadius: 42,
          clusterProperties: {
            total: ["+", ["coalesce", ["get", "count"], 1]],
          },
        });
        m.addLayer({
          id: "clusters",
          type: "circle",
          source: "locations",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#b5a276",
            "circle-radius": [
              "step",
              ["get", "point_count"],
              20,
              20,
              25,
              100,
              31,
            ],
            "circle-stroke-color": "#dfc998",
            "circle-stroke-width": 1,
            "circle-opacity": 0.93,
          },
        });
        m.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "locations",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "total"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 13,
          },
          paint: { "text-color": "#111513" },
        });
        m.addLayer({
          id: "places",
          type: "circle",
          source: "locations",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "clustered"], true],
              17,
              8,
            ],
            "circle-color": "#c9b587",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#504d3b",
          },
        });
        m.addLayer({
          id: "place-count",
          type: "symbol",
          source: "locations",
          filter: ["==", ["get", "clustered"], true],
          layout: {
            "text-field": ["get", "count"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
          },
          paint: { "text-color": "#111513" },
        });
        m.on("click", "clusters", async (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const zoom = await (
            m.getSource("locations") as GeoJSONSource
          ).getClusterExpansionZoom(feature.properties.cluster_id);
          m.easeTo({
            center: (feature.geometry as Point).coordinates as [number, number],
            zoom,
          });
        });
        m.on("click", "places", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (f.properties.clustered) {
            m.easeTo({
              center: (f.geometry as Point).coordinates as [number, number],
              zoom: m.getZoom() + 3,
            });
          } else selectRef.current(f.properties.slug);
        });
        for (const layer of ["places", "clusters"]) {
          m.on(
            "mouseenter",
            layer,
            () => (m.getCanvas().style.cursor = "pointer"),
          );
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        refresh();
      });
      m.on("moveend", refresh);
    } catch {
      setFailed(true);
      setStatus("Interactive maps need WebGL. Browse every place in the list.");
    }
    return () => {
      resizeObserver?.disconnect();
      controller.current?.abort();
      m?.remove();
      map.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    if (ready) refresh();
  }, [query, ready, refresh]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !locations.length || !query) return;
    const bounds = new maplibregl.LngLatBounds();
    locations.forEach((l) => bounds.extend([l.longitude, l.latitude]));
    m.fitBounds(bounds, {
      padding: 70,
      maxZoom: 10,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 700,
    });
  }, [query, ready, locations]);
  return (
    <div className="map-surface">
      <div
        className="map-container"
        ref={container}
        role="region"
        aria-label="Interactive Haunted Atlas. Drag to pan, use plus and minus to zoom. Locations are also available in the list."
      />
      <div
        className={`map-status ${failed ? "map-warning" : ""}`}
        role="status"
      >
        <span className={failed ? "" : "map-status-dot"} />
        {status}
      </div>
      <button
        className="map-reset"
        aria-label="Reset map to world view"
        title="Reset world view"
        onClick={() =>
          map.current?.flyTo({
            center: [-28, 34],
            zoom: 1.65,
            duration: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? 0
              : 600,
          })
        }
      >
        <Compass size={20} />
      </button>
      {failed && !ready && (
        <div className="map-fallback">
          <Compass size={54} strokeWidth={0.7} />
          <h2>The map is out of reach.</h2>
          <p>
            All location profiles and search results remain available in the
            list.
          </p>
        </div>
      )}
    </div>
  );
}
export default function Atlas() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"map" | "list">("map");
  const [selected, setSelected] = useState("");
  const query = new URLSearchParams(params);
  query.delete("page");
  const queryString = query.toString();
  const page = Number(params.get("page") || 1);
  const { data, error, loading } = useApi<LocationPage>(
    `/api/locations?${params.toString()}&pageSize=24`,
  );
  const preview = useApi<{ location: Location; nearby: Location[] }>(
    selected ? `/api/locations/${selected}` : null,
  );
  const { data: facets } = useApi<{
    categories: string[];
    phenomena: string[];
    regions: string[];
  }>("/api/meta");
  useEffect(() => setText(params.get("q") || ""), [params]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setSelected("");
  };
  const activeKeys = [
    "category",
    "phenomenon",
    "access",
    "tours",
    "region",
    "classification",
  ];
  const activeCount = activeKeys.filter((k) => params.has(k)).length;
  return (
    <main id="main" className="atlas-page">
      <div className="atlas-top">
        <div className="atlas-title">
          <Compass size={24} strokeWidth={1} />
          <div>
            <span className="eyebrow plain">Follow the stories</span>
            <h1>
              The Haunted Atlas<span>.</span>
            </h1>
          </div>
        </div>
        <form
          className="atlas-search"
          onSubmit={(e) => {
            e.preventDefault();
            change("q", text.trim());
          }}
        >
          <Search size={18} />
          <input
            aria-label="Search location name, city, state or country"
            placeholder="Search a place, city, or country"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100}
          />
          {text && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear search"
              onClick={() => {
                setText("");
                change("q", "");
              }}
            >
              <X size={15} />
            </button>
          )}
          <button
            className="search-submit"
            type="submit"
            aria-label="Search atlas"
          >
            <ArrowUpRight size={19} />
          </button>
        </form>
        <button
          className={`button filter-toggle ${filtersOpen ? "active" : ""}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={16} />
          Filters
          {activeCount > 0 && (
            <span className="filter-count">{activeCount}</span>
          )}
        </button>
        <div className="view-switch" aria-label="Atlas view">
          <button
            className={view === "map" ? "active" : ""}
            aria-label="Map view"
            aria-pressed={view === "map"}
            onClick={() => setView("map")}
          >
            <MapIcon size={16} />
            <span>Map</span>
          </button>
          <button
            className={view === "list" ? "active" : ""}
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={16} />
            <span>List</span>
          </button>
        </div>
      </div>
      {filtersOpen && (
        <div className="filter-panel">
          {[
            {
              key: "category",
              label: "Category",
              options: [
                ...new Set([...categories, ...(facets?.categories || [])]),
              ].map((v) => [v, v]),
            },
            {
              key: "phenomenon",
              label: "Reported phenomena",
              options: [
                ...new Set([...phenomena, ...(facets?.phenomena || [])]),
              ].map((v) => [v, v]),
            },
            {
              key: "access",
              label: "Public access",
              options: [
                ["public", "Visitors welcome"],
                ["restricted", "Restricted"],
                ["private", "Private"],
                ["unknown", "Not confirmed"],
              ],
            },
            {
              key: "tours",
              label: "Tours",
              options: [
                ["yes", "Tours available"],
                ["no", "No tours"],
                ["unknown", "Not confirmed"],
              ],
            },
            {
              key: "region",
              label: "Region",
              options: (
                facets?.regions || ["North America", "Europe", "Oceania"]
              ).map((v) => [v, v]),
            },
            {
              key: "classification",
              label: "Editorial classification",
              options: [
                ["established", "Established location"],
                ["local-legend", "Local legend"],
                ["community-discovery", "Community discovery"],
              ],
            },
          ].map((f) => (
            <label key={f.key}>
              {f.label}
              <select
                value={params.get(f.key) || ""}
                onChange={(e) => change(f.key, e.target.value)}
              >
                <option value="">
                  All{" "}
                  {f.key === "category"
                    ? "categories"
                    : f.key === "phenomenon"
                      ? "phenomena"
                      : "options"}
                </option>
                {f.options.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="text-link" onClick={() => setParams({})}>
            <RotateCcw size={14} />
            Reset all
          </button>
        </div>
      )}
      {(activeCount > 0 || params.get("q")) && (
        <div className="active-filters">
          {["q", ...activeKeys]
            .filter((k) => params.has(k))
            .map((k) => (
              <button key={k} onClick={() => change(k, "")}>
                {k === "q" ? "Search: " : ""}
                {params.get(k)}
                <X size={12} />
              </button>
            ))}
        </div>
      )}
      <div className={`atlas-body ${view === "list" ? "list-only" : ""}`}>
        <section className="atlas-results" aria-label="Matching locations">
          <div className="results-heading">
            <span>
              {loading
                ? "Searching…"
                : `${data?.total ?? 0} places to discover`}
            </span>
            <span>THE FIELD INDEX</span>
          </div>
          {loading ? (
            <Status loading />
          ) : error ? (
            <Status error={error} />
          ) : !data?.locations.length ? (
            <div className="empty-state">
              <Search size={30} />
              <h2>A quieter corner of the atlas.</h2>
              <p>
                No published places match these filters. Try a broader search.
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setText("");
                  setParams({});
                }}
              >
                Clear search & filters
              </button>
            </div>
          ) : (
            <div className="atlas-card-list">
              {data.locations.map((l) => (
                <LocationCard
                  key={l.id}
                  location={l}
                  compact={view === "map"}
                />
              ))}
            </div>
          )}
          {!!data && data.total > 24 && (
            <div className="pagination">
              <button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("page", String(page - 1));
                  setParams(next);
                }}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.ceil(data.total / 24)}
              </span>
              <button
                className="button secondary"
                disabled={page * 24 >= data.total}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("page", String(page + 1));
                  setParams(next);
                }}
              >
                Next
              </button>
            </div>
          )}
          <p className="map-editorial-note">
            Map markers identify places, not evidence of paranormal activity.
            Search covers the published archive.
          </p>
        </section>
        <section className="atlas-map-wrap" aria-label="Map view">
          <MapCanvas
            query={queryString}
            locations={data?.locations || []}
            onSelect={setSelected}
          />
          {selected && (
            <div className="map-preview">
              <button
                className="preview-close icon-button"
                onClick={() => setSelected("")}
                aria-label="Close location preview"
              >
                <X size={17} />
              </button>
              {preview.loading ? (
                <Status loading />
              ) : preview.error ? (
                <Status error={preview.error} />
              ) : (
                preview.data?.location && (
                  <>
                    <PlaceImage location={preview.data.location} />
                    <div>
                      <span className="eyebrow plain">
                        {preview.data.location.category}
                      </span>
                      <h2>{preview.data.location.name}</h2>
                      <p>
                        <MapPin size={12} />
                        {preview.data.location.city},{" "}
                        {preview.data.location.country}
                      </p>
                      <Link
                        className="button brass"
                        to={`/locations/${preview.data.location.slug}`}
                      >
                        Explore this place <ArrowUpRight size={16} />
                      </Link>
                    </div>
                  </>
                )
              )}
            </div>
          )}
          <div className="map-legend">
            <span />A documented place. An enduring story.
          </div>
        </section>
      </div>
      <div className="mobile-map-note">
        Use List view for accessible location details and profiles.
      </div>
    </main>
  );
}
