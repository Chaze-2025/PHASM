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
  History,
  Route,
} from "lucide-react";
import { useApi } from "./api";
import archivalImages from "../content/archival-images.json";
import type { LocationSummary, LocationPage } from "../shared/types";
import { LocationCard, Eyebrow, Status, PlaceImage } from "./components";
import { AtmosphericFog } from "./AtmosphericFog";
import { VeilSeal, VeilDivider } from "./VeilSeal";

const spiritPhotograph = archivalImages[0];

export function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data, error, loading } = useApi<LocationPage<LocationSummary>>(
    "/api/locations?pageSize=10&format=summary",
  );
  const { data: legends } = useApi<LocationPage<LocationSummary>>(
    "/api/locations?classification=local-legend&pageSize=1&format=summary",
  );
  const { data: facets } = useApi<{ regions: string[] }>("/api/meta");
  const legend = legends?.locations[0];
  const locations = data?.locations || [];
  const stanley = locations.find(
    (location) => location.slug === "stanley-hotel",
  );
  const recent = [...locations]
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name),
    )
    .slice(0, 3);
  const chosen = [
    "stanley-hotel",
    "eastern-state-penitentiary",
    "edinburgh-castle",
  ]
    .map((slug) => locations.find((location) => location.slug === slug))
    .filter(Boolean) as LocationSummary[];
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
      <AtmosphericFog />
      <section className="home-hero" aria-labelledby="home-title">
        <img
          className="home-hero-image"
          src="/images/eastern-state-penitentiary.webp"
          srcSet="/images/eastern-state-penitentiary-card.webp 720w, /images/eastern-state-penitentiary-1080.webp 1080w, /images/eastern-state-penitentiary-1280.webp 1280w, /images/eastern-state-penitentiary.webp 1920w"
          sizes="(max-width: 850px) 100vw, max(50vw, 960px)"
          alt="The vaulted cellblock gallery of Eastern State Penitentiary, with empty corridors receding into the distance."
          fetchPriority="high"
          decoding="async"
        />
        <div className="home-hero-registration" aria-hidden="true">
          <VeilSeal />
          <span>Beyond the veil</span>
        </div>
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <Eyebrow>Ghosts. Hauntings. The unexplained.</Eyebrow>
            <h1 id="home-title">
              <span>
                Every place
                <br />
                has a story.
              </span>
              <em>Some never rest.</em>
            </h1>
            <p>
              Explore haunted places across all 50 states and beyond. Uncover
              their histories and the ghost stories that linger.
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
              <span className="place-status-dot" /> A place with a haunting
              history
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
            places. Stories that linger.
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
              CC BY-SA 4.0 · cropped
            </a>
          </span>
        </div>
      </section>

      <VeilDivider />

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
              Spirited hotels. Silent cellblocks. Ancient strongholds.
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
        className="section home-state-gateway"
        aria-labelledby="state-gateway-title"
      >
        <div className="home-state-gateway-inner">
          <div>
            <Eyebrow>Closer than you think</Eyebrow>
            <h2 id="state-gateway-title">Every state has its shadows.</h2>
            <p>
              Find haunted hotels, forgotten landmarks, and local ghost stories
              across the United States.
            </p>
            <div
              className="home-state-shortcuts"
              aria-label="Explore haunted places by state"
            >
              <Link to="/haunted-places/louisiana">Louisiana</Link>
              <Link to="/haunted-places/pennsylvania">Pennsylvania</Link>
              <Link to="/haunted-places/new-york">New York</Link>
              <Link to="/haunted-places/california">California</Link>
            </div>
          </div>
          <Link to="/haunted-places" className="button secondary">
            Browse all 50 states <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
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
              by region, haunting, or the way you want to visit.
            </p>
            <Link to="/map" className="button home-spectral-button">
              <Map size={18} aria-hidden="true" /> Open the Haunted Atlas{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <div className="home-atlas-counts">
              <span>
                <strong>{data?.total ?? "—"}</strong> places to discover
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
                src="/images/atlas-preview.webp?v=charcoal-1"
                alt="Map preview showing haunted locations in North America and Europe. Open the atlas to explore all regions."
                width="1065"
                height="805"
                loading="lazy"
                decoding="async"
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

      <section className="home-archive" aria-labelledby="archive-title">
        <div className="section home-archive-inner">
          <figure className="home-archive-photograph">
            <div className="home-archive-mount">
              <span className="home-archive-register" aria-hidden="true">
                PHASM · Historical photograph
              </span>
              <img
                src={spiritPhotograph.src}
                alt={spiritPhotograph.alt}
                width={spiritPhotograph.width}
                height={spiritPhotograph.height}
                loading="lazy"
                decoding="async"
              />
              <span className="home-archive-date">
                {spiritPhotograph.date} · {spiritPhotograph.medium}
              </span>
            </div>
            <figcaption>
              <strong>William H. Mumler · Historical spirit photography</strong>
              <span>
                An unidentified sitter with a superimposed female figure.
              </span>
              <span>
                <a
                  href={spiritPhotograph.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  The J. Paul Getty Museum · Collection record
                </a>{" "}
                ·{" "}
                <a
                  href={spiritPhotograph.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  CC0
                </a>
              </span>
              <span>Full archival photograph · original scan colors.</span>
            </figcaption>
          </figure>
          <div className="home-archive-copy">
            <Eyebrow>From the spiritualist archive</Eyebrow>
            <h2 id="archive-title">
              When the camera
              <br />
              <em>saw ghosts.</em>
            </h2>
            <p>
              A seated figure. A pale companion fading into the frame. Early
              spirit photography brought the Victorian fascination with the
              spirit world into the portrait studio. These uncanny images still
              hold something of that longing to glimpse the other side.
            </p>
            <p className="home-archive-context">
              This staged historical spirit photograph uses a superimposed
              figure. From Getty’s collection, it offers a window into
              spiritualist culture; it does not depict an atlas location.
            </p>
            <a
              href={spiritPhotograph.contextSource.url}
              target="_blank"
              rel="noreferrer"
              className="text-link home-archive-source"
            >
              Read Getty’s photographic history{" "}
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            {stanley && (
              <article
                className="home-story-excerpt"
                aria-label="From the location dossiers: The Stanley Hotel"
              >
                <Link
                  to={`/locations/${stanley.slug}`}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  <PlaceImage
                    location={stanley}
                    sizes="(max-width: 600px) calc(100vw - 48px), 100px"
                  />
                </Link>
                <div>
                  <span className="home-story-kicker">
                    From the location dossiers · Colorado
                  </span>
                  <h3>Some stories still linger.</h3>
                  <p>
                    According to The Stanley Hotel’s Room 217 lore, former
                    housekeeper Elizabeth Wilson still tends to her guests,
                    tidying belongings long after her working days have ended.
                  </p>
                  <Link to={`/locations/${stanley.slug}`} className="text-link">
                    Read the Stanley dossier{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            )}
          </div>
        </div>
      </section>

      {legend && (
        <section className="section home-lore" aria-labelledby="lore-title">
          <Link
            className="home-lore-image"
            to={`/locations/${legend.slug}`}
            aria-label={`Explore ${legend.name}`}
          >
            <PlaceImage
              location={legend}
              sizes="(max-width: 600px) calc(100vw - 48px), (max-width: 1360px) 45vw, 615px"
            />
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
              Follow the stories passed down close to home.
            </span>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section home-recent" aria-labelledby="recent-title">
          <div className="home-section-heading">
            <div>
              <Eyebrow>Keep exploring</Eyebrow>
              <h2 id="recent-title">New to the atlas.</h2>
            </div>
            <Link to="/map" className="text-link">
              Browse the collection <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="home-recent-list">
            {recent.map((location) => (
              <Link
                to={`/locations/${location.slug}`}
                className="home-recent-place"
                key={location.id}
              >
                <PlaceImage
                  location={location}
                  sizes="(max-width: 850px) 68px, (max-width: 1100px) 55px, 68px"
                />
                <span>
                  <span className="home-recent-category">
                    {location.category}
                  </span>
                  <strong>{location.name}</strong>
                  <span className="home-recent-geography">
                    {location.city}, {location.country}
                  </span>
                </span>
                <ArrowUpRight size={19} aria-hidden="true" />
              </Link>
            ))}
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

      <section
        className="section home-reading-room"
        aria-labelledby="reading-title"
      >
        <div className="home-reading-title">
          <Eyebrow>The reading room</Eyebrow>
          <h2 id="reading-title">
            More ways into
            <br />
            <em>the unexplained.</em>
          </h2>
        </div>
        <div className="home-reading-item">
          <History size={23} strokeWidth={1.2} aria-hidden="true" />
          <span className="home-planned-label">Planned</span>
          <h3>Paranormal case files</h3>
          <p>
            Haunting accounts, forgotten histories, and the stories behind the
            mystery.
          </p>
          <Link to="/cases" className="text-link">
            About the case files <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="home-reading-item">
          <Route size={23} strokeWidth={1.2} aria-hidden="true" />
          <span className="home-planned-label">Planned</span>
          <h3>Haunted trails</h3>
          <p>
            Curated collections of haunted places connected by a region or a
            story.
          </p>
          <span className="home-reading-note">
            Collections are not yet published.
          </span>
        </div>
      </section>

      <section className="home-approach" aria-labelledby="approach-title">
        <div className="section home-approach-inner">
          <div>
            <Eyebrow>For the curious</Eyebrow>
            <h2 id="approach-title">
              Follow the story.
              <br />
              <em>Feel the mystery.</em>
            </h2>
            <Link to="/about" className="text-link">
              The PHASM approach <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="home-approach-principles">
            <p>
              <BookOpen size={21} strokeWidth={1.3} aria-hidden="true" />
              <span>
                <strong>Get to know the place.</strong>Meet the people, discover
                the history, and explore the hauntings that keep its story
                alive.
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
