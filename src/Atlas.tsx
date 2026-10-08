import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import { type Map as MapInstance, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./atlas-refinement.css";
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
import { LocationCard, PlaceImage, Status } from "./components";

// Let Vite fingerprint and publish the worker alongside this lazy-loaded bundle.
maplibregl.setWorkerUrl(mapWorkerUrl);
const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/dark";

// WebGL paint cannot resolve CSS variables. Read the shared design tokens once
// when the map loads. Cartography stays neutral charcoal; brass marks the places.
function mapPalette() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    land: token("--map-land", "#0C0C0C"),
    water: token("--map-water", "#1B1B1D"),
    label: token("--map-label", "#ADADAD"),
    marker: token("--map-marker", "#C2AD7C"),
    selected: token("--map-marker-selected", "#ECE9DF"),
    ring: token("--map-marker-ring", "#353535"),
    midnight: token("--map-ink", "#0C0C0C"),
    panel: token("--map-panel", "#1C1C1C"),
  };
}
function MapCanvas({
  query,
  locations,
  selected,
  onSelect,
}: {
  query: string;
  locations: Location[];
  selected: string;
  onSelect: (slug: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const queryRef = useRef(query);
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Loading the atlas…");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  queryRef.current = query;
  selectRef.current = onSelect;
  selectedRef.current = selected;
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
          : "No places in this area yet",
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
        "top-right",
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
        const colors = mapPalette();
        // Keep the provider’s charcoal geography and road detail intact. Neutral
        // silver labels and dark halos remain readable at every map scale.
        if (m.getLayer("background")?.type === "background")
          m.setPaintProperty("background", "background-color", colors.land);
        if (m.getLayer("water")?.type === "fill")
          m.setPaintProperty("water", "fill-color", colors.water);
        for (const layer of m.getStyle().layers) {
          if (
            layer.type === "symbol" &&
            /^(place_|highway_name_|water_name)/.test(layer.id)
          ) {
            m.setPaintProperty(layer.id, "text-color", colors.label);
            m.setPaintProperty(layer.id, "text-halo-color", colors.midnight);
            m.setPaintProperty(layer.id, "text-halo-width", 1);
          }
        }
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
            "circle-color": colors.panel,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              22,
              20,
              25,
              100,
              31,
            ],
            "circle-stroke-color": colors.marker,
            "circle-stroke-width": 1.5,
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
          paint: { "text-color": colors.selected },
        });
        m.addLayer({
          id: "place-rings",
          type: "circle",
          source: "locations",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "clustered"], true],
              22,
              13,
            ],
            "circle-color": colors.ring,
            "circle-opacity": 0.45,
            "circle-stroke-color": colors.marker,
            "circle-stroke-opacity": 0.38,
            "circle-stroke-width": 1,
          },
        });
        m.addLayer({
          id: "selected-place",
          type: "circle",
          source: "locations",
          filter: ["==", ["get", "slug"], selectedRef.current],
          paint: {
            "circle-radius": 20,
            "circle-color": colors.ring,
            "circle-opacity": 0.6,
            "circle-stroke-color": colors.selected,
            "circle-stroke-opacity": 1,
            "circle-stroke-width": 1.5,
          },
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
            "circle-color": colors.marker,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": colors.midnight,
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
          paint: { "text-color": colors.midnight },
        });
        // Give individual markers a comfortable touch target without enlarging
        // their visual footprint or changing their geographic coordinates.
        m.addLayer({
          id: "place-targets",
          type: "circle",
          source: "locations",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-radius": 22, "circle-opacity": 0 },
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
            duration: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? 0
              : 450,
          });
        });
        m.on("click", "place-targets", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (f.properties.clustered) {
            m.easeTo({
              center: (f.geometry as Point).coordinates as [number, number],
              zoom: m.getZoom() + 3,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 450,
            });
          } else {
            selectRef.current(f.properties.slug);
            // Keep the selected pin above the compact preview on shorter phones.
            if (
              m.getCanvas().clientWidth <= 600 &&
              m.getCanvas().clientHeight < 480
            ) {
              m.easeTo({
                center: (f.geometry as Point).coordinates as [number, number],
                offset: [0, -75],
                duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? 0
                  : 350,
              });
            }
          }
        });
        for (const layer of ["place-targets", "clusters"]) {
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
    if (!ready || !m?.getLayer("selected-place")) return;
    const colors = mapPalette();
    m.setFilter("selected-place", ["==", ["get", "slug"], selected]);
    m.setPaintProperty("places", "circle-color", [
      "case",
      ["==", ["get", "slug"], selected],
      colors.selected,
      colors.marker,
    ]);
  }, [ready, selected]);
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
  const filterToggle = useRef<HTMLButtonElement>(null);
  const closeFilters = () => {
    setFiltersOpen(false);
    filterToggle.current?.focus();
  };
  useEffect(() => {
    if (!filtersOpen && !selected) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (filtersOpen) {
        setFiltersOpen(false);
        filterToggle.current?.focus();
      } else setSelected("");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [filtersOpen, selected]);
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
      <div className="atlas-controls">
        <div className="atlas-top">
          <div className="atlas-title">
            <Compass size={24} strokeWidth={1} />
            <div>
              <span className="eyebrow plain">
                A field guide to the unexplained
              </span>
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
              setFiltersOpen(false);
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
            ref={filterToggle}
            aria-controls="atlas-filters"
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
              onClick={() => {
                setView("map");
                setFiltersOpen(false);
              }}
            >
              <MapIcon size={16} />
              <span>Map</span>
            </button>
            <button
              className={view === "list" ? "active" : ""}
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => {
                setView("list");
                setFiltersOpen(false);
              }}
            >
              <List size={16} />
              <span>List</span>
            </button>
          </div>
        </div>
        {filtersOpen && (
          <section
            className="filter-panel"
            id="atlas-filters"
            aria-label="Filter locations"
          >
            <div className="filter-panel-heading">
              <div>
                <span className="eyebrow plain">Narrow the search</span>
                <h2>Find your kind of mystery.</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close filters"
                onClick={closeFilters}
              >
                <X size={20} />
              </button>
            </div>
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
                label: "Location type",
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
            <div className="filter-panel-actions">
              <button
                className="text-link"
                onClick={() => {
                  setParams({});
                  setSelected("");
                }}
              >
                <RotateCcw size={15} />
                Reset all
              </button>
              <button className="button brass" onClick={closeFilters}>
                Show places
              </button>
            </div>
          </section>
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
      </div>
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
                No haunted places match these filters. Try a broader search.
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
            Follow the markers to haunted places, local legends, and their
            stories.
          </p>
        </section>
        <section
          className={`atlas-map-wrap ${selected ? "has-selection" : ""}`}
          aria-label="Map view"
        >
          <MapCanvas
            query={queryString}
            locations={data?.locations || []}
            selected={selected}
            onSelect={setSelected}
          />
          {selected && (
            <div
              className="map-preview"
              role="region"
              aria-label="Selected location preview"
            >
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
            <span />
            Locations & local legends
          </div>
        </section>
      </div>
      <div className="mobile-map-note">
        Explore the map, or choose List for every location.
      </div>
    </main>
  );
}
