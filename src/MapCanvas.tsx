import { memo, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { type Map as MapInstance, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Compass, X } from "lucide-react";
import type { Point } from "geojson";
import { api } from "./api";
import type { AtlasGeoJSON } from "../shared/types";
import { AtlasFeed, atlasBounds } from "./atlas-data";
import { overlappingMapChoices, type MapChoice } from "./map-selection";
import "./map-selection.css";

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
  selected,
  onSelect,
  requestFeed,
}: {
  query: string;
  selected: string;
  onSelect: (slug: string) => void;
  requestFeed?: (path: string, signal: AbortSignal) => Promise<AtlasGeoJSON>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const queryRef = useRef(query);
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const feed = useRef<AtlasFeed | null>(null);
  const requestRef = useRef(requestFeed);
  const [status, setStatus] = useState("Loading the atlas…");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [choices, setChoices] = useState<MapChoice[]>([]);
  const chooserClose = useRef<HTMLButtonElement>(null);
  queryRef.current = query;
  selectRef.current = onSelect;
  selectedRef.current = selected;
  requestRef.current = requestFeed;
  const closeChooser = () => {
    setChoices([]);
    map.current?.getCanvas().focus();
  };
  const selectPlace = (choice: MapChoice) => {
    setChoices([]);
    selectRef.current(choice.slug);
    const m = map.current;
    // Keep the selected pin above the compact preview on shorter phones.
    if (
      m &&
      m.getCanvas().clientWidth <= 600 &&
      m.getCanvas().clientHeight < 480
    ) {
      m.easeTo({
        center: choice.coordinates,
        offset: [0, -75],
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 350,
      });
    }
  };
  useEffect(() => {
    if (!choices.length) return;
    chooserClose.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChoices([]);
        map.current?.getCanvas().focus();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [choices]);
  useEffect(() => {
    if (!container.current) return;
    let m: MapInstance;
    let sourceRevision = 0;
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
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      });
      map.current = m;
      const currentFeed = new AtlasFeed(
        (path, signal) =>
          requestRef.current
            ? requestRef.current(path, signal)
            : api<AtlasGeoJSON>(path, { signal }),
        {
          viewport: () => {
            const bounds = m.getBounds();
            return {
              bounds: atlasBounds(
                bounds.getWest(),
                bounds.getSouth(),
                bounds.getEast(),
                bounds.getNorth(),
              ),
              zoom: m.getZoom(),
            };
          },
          isCurrent: (filter) =>
            map.current === m && queryRef.current === filter,
          loading: (filterChanged) => {
            setStatus("Updating places…");
            if (filterChanged) {
              sourceRevision++;
              // Cancel an obsolete filter's camera animation before it can fetch tiles.
              m.stop();
              (m.getSource("locations") as GeoJSONSource)?.setData({
                type: "FeatureCollection",
                features: [],
              });
            }
          },
          data: (data, filterChanged) => {
            setChoices([]);
            sourceRevision++;
            (m.getSource("locations") as GeoJSONSource).setData(data);
            if (!filterChanged || !queryRef.current || !data.features.length)
              return false;
            const bounds = new maplibregl.LngLatBounds();
            data.features.forEach((feature) =>
              bounds.extend(feature.geometry.coordinates as [number, number]),
            );
            m.fitBounds(bounds, {
              padding: Math.min(
                70,
                Math.min(
                  m.getCanvas().clientWidth,
                  m.getCanvas().clientHeight,
                ) / 4,
              ),
              maxZoom: 10,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 700,
            });
            return true;
          },
          count: (total) =>
            setStatus(
              total
                ? `${total} mapped ${total === 1 ? "place" : "places"} in this area`
                : "No mapped places in this area",
            ),
          error: () =>
            setStatus("Places could not load. Move the map to retry."),
        },
      );
      feed.current = currentFeed;
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
          const revision = sourceRevision;
          const filter = queryRef.current;
          try {
            const zoom = await (
              m.getSource("locations") as GeoJSONSource
            ).getClusterExpansionZoom(feature.properties.cluster_id);
            if (
              map.current !== m ||
              sourceRevision !== revision ||
              queryRef.current !== filter
            )
              return;
            m.easeTo({
              center: (feature.geometry as Point).coordinates as [
                number,
                number,
              ],
              zoom,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 450,
            });
          } catch {
            // A filter or viewport update may replace a cluster during its lookup.
          }
        });
        m.on("click", "place-targets", (e) => {
          const overlapping = overlappingMapChoices(e.features || []);
          if (overlapping.length > 1) {
            selectRef.current("");
            setChoices(overlapping);
            return;
          }
          if (overlapping.length === 1) {
            selectPlace(overlapping[0]);
            return;
          }
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
      });
      m.on("moveend", () => {
        void currentFeed.move();
      });
    } catch {
      setFailed(true);
      setStatus("Interactive maps need WebGL. Browse every place in the list.");
    }
    return () => {
      feed.current?.dispose();
      feed.current = null;
      m?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    setChoices([]);
    if (ready) void feed.current?.load(query);
  }, [query, ready]);
  useEffect(() => {
    if (selected) setChoices([]);
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
      {choices.length > 1 && (
        <section
          className="map-pin-chooser"
          role="dialog"
          aria-modal="false"
          aria-label="Choose a place on the map"
        >
          <button
            ref={chooserClose}
            className="icon-button map-pin-chooser-close"
            aria-label="Close overlapping places"
            onClick={closeChooser}
          >
            <X size={18} />
          </button>
          <h2>{choices.length} places here</h2>
          <p>These map markers overlap. Choose a place to explore.</p>
          <ul>
            {choices.map((choice) => (
              <li key={choice.slug}>
                <button onClick={() => selectPlace(choice)}>
                  <span>{choice.name}</span>
                  {choice.category && <small>{choice.category}</small>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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

export default memo(MapCanvas);
