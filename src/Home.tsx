import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Compass,
  BookOpen,
  Map,
  ShieldCheck,
} from "lucide-react";
import { useApi } from "./api";
import type { Location, LocationPage } from "../shared/types";
import { LocationCard, Eyebrow, Status, PlaceImage } from "./components";

export function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data, error, loading } = useApi<LocationPage>(
    "/api/locations?pageSize=6",
  );
  const { data: legends } = useApi<LocationPage>(
    "/api/locations?classification=local-legend&pageSize=1",
  );
  const { data: facets } = useApi<{ regions: string[] }>("/api/meta");
  const legend = legends?.locations[0];
  const locations = data?.locations || [];
  const chosen = [
    "stanley-hotel",
    "eastern-state-penitentiary",
    "edinburgh-castle",
  ]
    .map((slug) => locations.find((location) => location.slug === slug))
    .filter(Boolean) as Location[];
  const featured = locations
    .filter((location) => location.featured)
    .slice(0, 3);
  const displayed =
    chosen.length === 3
      ? chosen
      : featured.length
        ? featured
        : locations.slice(0, 3);

  return (
    <main id="main" className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <img
          className="home-hero-image"
          src="/images/eastern-state-penitentiary.webp"
          srcSet="/images/eastern-state-penitentiary-card.webp 720w, /images/eastern-state-penitentiary.webp 1920w"
          sizes="(max-width: 700px) 100vw, 75vw"
          alt="The vaulted cellblock gallery of Eastern State Penitentiary, with empty corridors receding into the distance."
          fetchPriority="high"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <Eyebrow>A field guide to the unexplained</Eyebrow>
            <h1 id="home-title">
              <span>
                Every place
                <br />
                has a story.
              </span>
              <em>Some never rest.</em>
            </h1>
            <p>
              Discover haunted places, uncover their histories, and explore the
              stories that refuse to fade.
            </p>
            <form
              className="home-search"
              onSubmit={(event) => {
                event.preventDefault();
                navigate(
                  `/map${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
                );
              }}
            >
              <div className="home-search-input">
                <Search size={20} aria-hidden="true" />
                <input
                  aria-label="Search for haunted places or a region"
                  placeholder="Search a place, city or region"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                />
              </div>
              <button type="submit">
                Find haunted places <ArrowRight size={18} aria-hidden="true" />
              </button>
            </form>
            <Link to="/map" className="home-atlas-link">
              <Map size={18} aria-hidden="true" /> Explore the Haunted Atlas{" "}
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <Link
            to="/locations/eastern-state-penitentiary"
            className="hero-place-label"
          >
            <span className="hero-place-label-top">
              <span className="place-status-dot" /> Inside the archive
            </span>
            <strong>Eastern State Penitentiary</strong>
            <span>
              Philadelphia, Pennsylvania{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </span>
          </Link>
        </div>
        <div className="home-hero-footer">
          <span>
            <Compass size={16} strokeWidth={1.4} aria-hidden="true" /> Real
            places. Unanswered questions.
          </span>
          <span className="home-photo-credit">
            <a
              href="https://commons.wikimedia.org/wiki/File:Eastern_state_penitentiary_cellblock_gallery.jpg"
              target="_blank"
              rel="noreferrer"
            >
              Photo: Gangway Ghost
            </a>
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0 · cropped &amp; toned
            </a>
          </span>
        </div>
      </section>

      <section
        className="section home-featured"
        aria-labelledby="featured-title"
      >
        <div className="home-section-heading">
          <div>
            <Eyebrow>Places that stay with you</Eyebrow>
            <h2 id="featured-title">Step into the story.</h2>
          </div>
          <div className="home-section-intro">
            <p>
              Storied hotels. Silent cellblocks. Ancient strongholds.
              <br className="desktop-break" /> Find your next encounter with the
              unexplained.
            </p>
            <Link to="/map" className="text-link">
              Explore all places <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
        {loading ? (
          <Status loading />
        ) : error ? (
          <Status error={error} />
        ) : (
          <div className="location-grid">
            {displayed.map((location) => (
              <LocationCard key={location.id} location={location} />
            ))}
          </div>
        )}
      </section>

      <section
        className="section home-atlas-section"
        aria-labelledby="atlas-title"
      >
        <div className="home-atlas-panel">
          <div className="home-atlas-copy">
            <Eyebrow>The Haunted Atlas</Eyebrow>
            <h2 id="atlas-title">
              The world has
              <br />
              <em>its secrets.</em>
            </h2>
            <p>
              Find them on the map. Explore haunted landmarks and local legends
              by place, reported phenomena, or the way you want to visit.
            </p>
            <Link to="/map" className="button brass">
              <Map size={18} aria-hidden="true" /> Open the Haunted Atlas{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <div className="home-atlas-counts">
              <span>
                <strong>{data?.total ?? "—"}</strong> sourced places
              </span>
              <span>
                <strong>{facets?.regions.length ?? "—"}</strong> regions to
                explore
              </span>
            </div>
          </div>
          <figure className="home-atlas-visual">
            <Link
              to="/map"
              className="home-map-preview"
              aria-label="Open the interactive Haunted Atlas"
            >
              <img
                src="/images/atlas-preview.webp"
                alt="Map preview showing sourced haunted locations in North America and Europe. Open the atlas to explore all regions."
                width="1065"
                height="821"
                loading="lazy"
              />
              <span className="home-map-preview-label">
                <Compass size={17} aria-hidden="true" /> Map preview{" "}
                <ArrowUpRight size={16} aria-hidden="true" />
              </span>
            </Link>
            <figcaption>
              <span>Discover what lies beyond the familiar.</span>
              <span>
                Map:{" "}
                <a
                  href="https://openfreemap.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenFreeMap
                </a>{" "}
                · ©{" "}
                <a
                  href="https://openmaptiles.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenMapTiles
                </a>{" "}
                ·{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap
                </a>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {legend && (
        <section className="section home-lore" aria-labelledby="lore-title">
          <Link
            className="home-lore-image"
            to={`/locations/${legend.slug}`}
            aria-label={`Explore ${legend.name}`}
          >
            <PlaceImage location={legend} />
            <span>Local legend</span>
          </Link>
          <div className="home-lore-copy">
            <Eyebrow>Beyond the well-known</Eyebrow>
            <h2 id="lore-title">
              Some stories belong
              <br />
              to the landscape.
            </h2>
            <p className="home-lore-place">
              <MapPin size={15} aria-hidden="true" /> {legend.name} ·{" "}
              {legend.state}
            </p>
            <p>{legend.summary}</p>
            <Link to={`/locations/${legend.slug}`} className="text-link">
              Discover the local story{" "}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <span className="home-lore-footnote">
              Regional folklore, with its history kept in view.
            </span>
          </div>
        </section>
      )}

      <section className="section home-regions" aria-labelledby="regions-title">
        <div className="home-section-heading">
          <div>
            <Eyebrow>Follow your curiosity</Eyebrow>
            <h2 id="regions-title">
              Choose a corner
              <br />
              <em>of the unknown.</em>
            </h2>
          </div>
          <p>
            Far from home or closer than you think.
            <br />
            There is a story waiting to be found.
          </p>
        </div>
        <div className="home-region-list">
          {[
            {
              name: "North America",
              note: "Grand hotels & restless histories",
              number: "01",
            },
            {
              name: "Europe",
              note: "Ancient castles & enduring folklore",
              number: "02",
            },
            {
              name: "Oceania",
              note: "Convict histories & after-dark tales",
              number: "03",
            },
          ].map((region) => (
            <Link
              to={`/map?region=${encodeURIComponent(region.name)}`}
              className="home-region-link"
              key={region.name}
            >
              <span className="home-region-number">{region.number}</span>
              <h3>{region.name}</h3>
              <p>{region.note}</p>
              <ArrowUpRight size={22} strokeWidth={1.3} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className="home-approach" aria-labelledby="approach-title">
        <div className="section home-approach-inner">
          <div>
            <Eyebrow>Curiosity, with care</Eyebrow>
            <h2 id="approach-title">
              History documented.
              <br />
              <em>Mystery kept open.</em>
            </h2>
            <Link to="/about" className="text-link">
              The PHASM approach <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="home-approach-principles">
            <p>
              <BookOpen size={21} strokeWidth={1.3} aria-hidden="true" />
              <span>
                <strong>Know the history.</strong>Documented facts and
                attributed paranormal reports, clearly distinguished.
              </span>
            </p>
            <p>
              <ShieldCheck size={21} strokeWidth={1.3} aria-hidden="true" />
              <span>
                <strong>Explore with respect.</strong>Check official visiting
                guidance. Leave private and restricted places undisturbed.
              </span>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
