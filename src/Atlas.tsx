import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { useApi } from "./api";
import {
  categories,
  phenomena,
  type LocationSummary,
  type LocationPage,
} from "../shared/types";
import { LocationCard, PlaceImage, Status } from "./components";

const MapCanvas = lazy(() => import("./MapCanvas"));

export default function Atlas() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"map" | "list">(
    params.get("view") === "list" ? "list" : "map",
  );
  const [mapVisited, setMapVisited] = useState(view === "map");
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
  query.delete("view");
  const queryString = query.toString();
  const page = Number(params.get("page") || 1);
  const { data, error, loading } = useApi<LocationPage<LocationSummary>>(
    `/api/locations?${params.toString()}&pageSize=24&format=summary`,
  );
  const preview = useApi<{ location: LocationSummary }>(
    selected ? `/api/locations/${selected}?format=summary` : null,
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
                setMapVisited(true);
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
                : `${data?.total ?? 0} ${(data?.total ?? 0) === 1 ? "profile" : "profiles"} to discover`}
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
            Explore each place on the map. Approximate pins mark site reference
            points; check the profile for visiting access and restrictions.
          </p>
        </section>
        <section
          className={`atlas-map-wrap ${selected ? "has-selection" : ""}`}
          aria-label="Map view"
        >
          {mapVisited && (
            <Suspense fallback={<Status loading />}>
              <MapCanvas
                query={queryString}
                selected={selected}
                onSelect={setSelected}
              />
            </Suspense>
          )}
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
                        {[
                          preview.data.location.city,
                          preview.data.location.state,
                          preview.data.location.country,
                        ]
                          .filter(Boolean)
                          .join(", ")}
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
            Places with public map pins
          </div>
        </section>
      </div>
      <div className="mobile-map-note">
        Explore mapped places, or choose List for every profile.
      </div>
    </main>
  );
}
