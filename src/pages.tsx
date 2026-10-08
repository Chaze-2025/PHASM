import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Search,
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Compass,
  BookOpen,
  Globe2,
  ExternalLink,
  Route,
  ShieldCheck,
  ChevronRight,
  Map,
  Bookmark,
  Camera,
  Clock3,
  Sparkles,
} from "lucide-react";
import { useApi, useSaved } from "./api";
import type { Location, LocationPage } from "../shared/types";
import {
  LocationCard,
  Eyebrow,
  PageHeading,
  Status,
  SaveButton,
  PlaceImage,
  classificationLabel,
} from "./components";
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
  const featured = locations.filter((p) => p.featured).slice(0, 3);
  const chosen = [
    "stanley-hotel",
    "eastern-state-penitentiary",
    "edinburgh-castle",
  ]
    .map((slug) => locations.find((l) => l.slug === slug))
    .filter(Boolean) as Location[];
  const displayed =
    chosen.length === 3
      ? chosen
      : featured.length
        ? featured
        : locations.slice(0, 3);
  return (
    <main id="main">
      <section className="hero">
        <img
          className="hero-image"
          src="/images/hero.webp"
          alt="Edinburgh Castle rising over the rocky slopes of Castle Rock"
          fetchPriority="high"
        />
        <div className="hero-shade" />
        <div className="hero-content">
          <Eyebrow>For the curious. For the unexplained.</Eyebrow>
          <h1>
            Some places
            <br />
            stay with you.
          </h1>
          <p>
            Discover haunted places. Uncover their histories.
            <br className="desktop-break" /> Find what lies beyond the familiar.
          </p>
          <form
            className="hero-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/map${q ? `?q=${encodeURIComponent(q)}` : ""}`);
            }}
          >
            <Search size={20} />
            <input
              aria-label="Search for haunted places or a region"
              placeholder="A place, a city, a whisper of something…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="submit">
              Find haunted places <ArrowRight size={17} />
            </button>
          </form>
          <div className="hero-trending">
            <span>Begin somewhere</span>
            <Link to="/map?region=North+America">North America</Link>
            <Link to="/map?region=Europe">Europe</Link>
            <Link to="/map?region=Oceania">Oceania</Link>
          </div>
        </div>
        <div className="hero-photo-credit">
          <Link to="/locations/edinburgh-castle">
            Edinburgh Castle · VegasGav7777
          </Link>
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 4.0 · cropped & toned
          </a>
        </div>
        <div className="hero-bottom">
          <span>
            <Compass size={15} /> THE WORLD HAS ITS SECRETS.
          </span>
          <Link to="/map">
            Explore the Haunted Atlas <ArrowUpRight size={17} />
          </Link>
        </div>
      </section>
      <div className="principles-bar">
        <span>
          <MapPin />
          Real places. Remarkable stories.
        </span>
        <span>
          <BookOpen />
          History meets the unexplained.
        </span>
        <span>
          <ShieldCheck />
          Explore with curiosity. Visit with respect.
        </span>
      </div>
      <section className="section featured-section">
        <div className="section-heading">
          <div>
            <Eyebrow>From the archive</Eyebrow>
            <h2>
              Every place has a story.
              <br />
              <em>Some have another.</em>
            </h2>
          </div>
          <Link to="/map" className="text-link">
            Explore all places <ArrowRight size={17} />
          </Link>
        </div>
        {loading ? (
          <Status loading />
        ) : error ? (
          <Status error={error} />
        ) : (
          <div className="location-grid">
            {displayed.map((p) => (
              <LocationCard key={p.id} location={p} />
            ))}
          </div>
        )}
      </section>
      <section className="atlas-banner section">
        <div className="atlas-banner-copy">
          <Eyebrow>The Haunted Atlas</Eyebrow>
          <h2>
            The unknown.
            <br />
            Closer than you think.
          </h2>
          <p>
            From storied landmarks to local legends, follow your curiosity
            across an ever-growing atlas of haunted places.
          </p>
          <Link to="/map" className="button brass">
            <Map size={17} /> Explore the map <ArrowUpRight size={17} />
          </Link>
          <div className="atlas-facts">
            <span>
              <strong>{data?.total || "—"}</strong> sourced places
            </span>
            <span>
              <strong>{facets?.regions.length || "—"}</strong> regions to
              explore
            </span>
            <span>
              <strong>∞</strong> questions to ask
            </span>
          </div>
        </div>
        <Link
          to="/map"
          className="atlas-art"
          aria-label="Open the interactive Haunted Atlas"
        >
          <div className="coordinate-grid" />
          <Globe2 strokeWidth={0.35} />
          <span className="atlas-point point-1" />
          <span className="atlas-point point-2" />
          <span className="atlas-point point-3" />
          <span className="atlas-point point-4" />
          <span className="atlas-art-label">
            <Compass size={16} /> A WORLD WORTH EXPLORING
          </span>
        </Link>
      </section>
      {legend && (
        <section className="section lore-section">
          <Link
            to={`/locations/${legend.slug}`}
            className="lore-photo"
            aria-label={`Explore ${legend.name}`}
          >
            <PlaceImage location={legend} />
          </Link>
          <div className="lore-copy">
            <Eyebrow>Beyond the familiar</Eyebrow>
            <span className="pill">Local legend</span>
            <h2>{legend.name}</h2>
            <p className="place-geography">
              <MapPin size={14} />
              {legend.state}, {legend.country}
            </p>
            <p>{legend.summary}</p>
            <Link className="text-link" to={`/locations/${legend.slug}`}>
              Follow the local story <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      )}
      <section className="section regions-section">
        <div className="section-heading">
          <div>
            <Eyebrow>Follow your curiosity</Eyebrow>
            <h2>Where will you look?</h2>
          </div>
          <span className="subtle">Old stories. New perspectives.</span>
        </div>
        <div className="region-grid">
          {[
            {
              name: "North America",
              note: "Grand hotels & restless histories",
              icon: "01",
            },
            {
              name: "Europe",
              note: "Ancient castles & enduring folklore",
              icon: "02",
            },
            {
              name: "Oceania",
              note: "Convict histories & after-dark tales",
              icon: "03",
            },
          ].map((r) => (
            <Link
              to={`/map?region=${encodeURIComponent(r.name)}`}
              className="region-card"
              key={r.name}
            >
              <span className="region-number">{r.icon}</span>
              <div>
                <h3>{r.name}</h3>
                <p>{r.note}</p>
              </div>
              <ArrowUpRight size={20} />
            </Link>
          ))}
        </div>
      </section>
      <section className="belief-strip">
        <Compass size={35} strokeWidth={0.8} />
        <h2>An open mind. A considered approach.</h2>
        <p>
          We document the history. We attribute the stories.
          <br />
          What you make of the unexplained is up to you.
        </p>
        <Link to="/about" className="text-link">
          The PHASM approach <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  );
}
export function Profile() {
  const { slug } = useParams();
  const { data, error, loading } = useApi<{
    location: Location;
    nearby: Location[];
  }>(`/api/locations/${encodeURIComponent(slug || "")}`);
  const p = data?.location;
  useEffect(() => {
    if (p) {
      document.title = `${p.name} — History & Visiting Guide | PHASM`;
      const meta = document.querySelector('meta[name="description"]');
      meta?.setAttribute("content", p.summary);
    }
  }, [p]);
  if (loading)
    return (
      <main id="main" className="page-shell">
        <Status loading />
      </main>
    );
  if (error || !p)
    return (
      <main id="main" className="page-shell">
        <Status
          error={error || "This place is not in the published archive."}
        />
        <Link to="/map" className="text-link">
          Return to the atlas
        </Link>
      </main>
    );
  return (
    <main id="main" className="profile">
      <div className="breadcrumb section">
        <Link to="/">Discover</Link>
        <ChevronRight size={13} />
        <Link to="/map">Haunted Atlas</Link>
        <ChevronRight size={13} />
        <span>{p.name}</span>
      </div>
      <section className="profile-hero">
        <PlaceImage location={p} className="profile-image" />
        <div className="profile-hero-shade" />
        <div className="profile-hero-copy">
          <span className="pill">{classificationLabel(p.classification)}</span>
          <h1>{p.name}</h1>
          <p>
            <MapPin size={17} />
            {[p.city, p.state, p.country].filter(Boolean).join(", ")}
          </p>
        </div>
        <span className="photo-caption">
          {p.imageCredit} · {p.imageLicense}
        </span>
      </section>
      <div className="profile-subnav section">
        <div>
          <span>{p.category}</span>
          <span>
            {p.coordinatePrecision === "approximate"
              ? "Approximate location"
              : "Geographic location documented"}
          </span>
        </div>
        <SaveButton slug={p.slug} label />
      </div>
      <div className="profile-layout section">
        <article className="profile-article">
          <p className="profile-intro">{p.summary}</p>
          <section id="history">
            <Eyebrow>Documented history</Eyebrow>
            <h2>Before the stories.</h2>
            <p>{p.history}</p>
          </section>
          <section id="reports">
            <Eyebrow>Reported, not established</Eyebrow>
            <h2>The unexplained.</h2>
            <p>{p.reports}</p>
            <div className="tag-list">
              {p.phenomena.map((tag) => (
                <Link
                  key={tag}
                  to={`/map?phenomenon=${encodeURIComponent(tag)}`}
                >
                  <Sparkles size={12} />
                  {tag}
                </Link>
              ))}
            </div>
            <p className="editorial-note">
              <ShieldCheck size={18} />
              These accounts are folklore or reported experiences. They are not
              verified evidence of paranormal activity.
            </p>
          </section>
          <section id="gallery">
            <Eyebrow>The visual record</Eyebrow>
            <h2>From the archive.</h2>
            <figure className="gallery-photo">
              <PlaceImage location={p} className="profile-image" />
              <figcaption>
                {p.imageCredit} ·{" "}
                {p.imageLicense === "CC BY-SA 4.0" ? (
                  <a
                    href="https://creativecommons.org/licenses/by-sa/4.0/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {p.imageLicense}
                  </a>
                ) : (
                  p.imageLicense
                )}{" "}
                {p.imageSource && (
                  <a href={p.imageSource} target="_blank" rel="noreferrer">
                    Image source <ExternalLink size={12} />
                  </a>
                )}
              </figcaption>
            </figure>
          </section>
          <section id="experiences">
            <Eyebrow>Community field notes</Eyebrow>
            <h2>Every experience belongs.</h2>
            <div className="empty-experiences">
              <BookOpen size={25} strokeWidth={1} />
              <h3>The next chapter is yours.</h3>
              <p>
                Community experiences are planned. Whether you encounter
                something unusual or simply enjoy the visit, your perspective
                will be welcome.
              </p>
              <span className="pill">Submissions are not open yet</span>
            </div>
            <p className="subtle small">
              Reviews will describe the visitor experience, never measure
              paranormal activity. Authentication and moderation will be in
              place before submissions open.
            </p>
          </section>
          <section id="sources">
            <Eyebrow>Follow the evidence</Eyebrow>
            <h2>Sources & further reading.</h2>
            <ol className="source-list">
              {p.sources.map((source, i) => (
                <li key={source.url + i}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    <span>
                      <small>{source.kind}</small>
                      {source.title}
                    </span>
                    <ArrowUpRight size={18} />
                  </a>
                </li>
              ))}
            </ol>
            <p className="small subtle">
              Last editorial update:{" "}
              {new Date(p.updatedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </p>
          </section>
        </article>
        <aside className="visit-card">
          <Eyebrow>Before you go</Eyebrow>
          <h2>
            A little preparation.
            <br />A better visit.
          </h2>
          <dl>
            <div>
              <dt>
                <MapPin size={15} />
                Public access
              </dt>
              <dd>
                {p.access === "public"
                  ? "Visitors welcome"
                  : p.access === "restricted"
                    ? "Restricted access"
                    : p.access === "private"
                      ? "Private property"
                      : "Not confirmed"}
              </dd>
            </div>
            <div>
              <dt>
                <Route size={15} />
                Guided tours
              </dt>
              <dd>
                {p.tours === "yes"
                  ? "Available — check official details"
                  : p.tours === "no"
                    ? "Not offered"
                    : "Not confirmed"}
              </dd>
            </div>
          </dl>
          <p>{p.accessNotes}</p>
          {p.officialUrl && (
            <a
              className="button brass"
              href={p.officialUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official visitor information <ExternalLink size={15} />
            </a>
          )}
          <Link
            className="button secondary"
            to={`/map?q=${encodeURIComponent(p.name)}`}
          >
            <Map size={16} />
            View on the atlas
          </Link>
          {p.access !== "private" && p.coordinatePrecision === "exact" && (
            <a
              className="text-link"
              href={`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Get directions <ArrowUpRight size={15} />
            </a>
          )}
          <div className="respect-note">
            <ShieldCheck size={17} />
            <p>
              Respect the place and the people connected to it. Check opening
              times, stay on permitted routes, and never trespass.
            </p>
          </div>
        </aside>
      </div>
      {!!data.nearby?.length && (
        <section className="section related-section">
          <div className="section-heading">
            <div>
              <Eyebrow>Keep exploring</Eyebrow>
              <h2>Other stories in the archive.</h2>
            </div>
          </div>
          <div className="location-grid">
            {data.nearby.slice(0, 3).map((l) => (
              <LocationCard key={l.id} location={l} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
function SavedEntry({ slug }: { slug: string }) {
  const { data, error, loading } = useApi<{ location: Location }>(
    `/api/locations/${slug}`,
  );
  const { toggle } = useSaved();
  return loading ? (
    <Status loading />
  ) : error ? (
    <div className="empty-state">
      <h3>Place unavailable</h3>
      <p>This saved profile may have been withdrawn from publication.</p>
      <button className="button secondary" onClick={() => toggle(slug)}>
        Remove from saved
      </button>
    </div>
  ) : data ? (
    <LocationCard location={data.location} />
  ) : null;
}
export function Saved() {
  const { saved } = useSaved();
  const [page, setPage] = useState(1);
  const shown = saved.slice((page - 1) * 12, page * 12);
  return (
    <main id="main" className="page-shell">
      <PageHeading
        eyebrow="Your personal field notes"
        title="Places that stay with you."
        description="A little collection of places you’re curious about. Saved on this browser, ready for your next exploration."
      />
      <p className="storage-note">
        <Bookmark size={16} />
        Device-local collection · No account required · Not synced between
        devices
      </p>
      {saved.length ? (
        <>
          <div className="location-grid">
            {shown.map((slug) => (
              <SavedEntry key={slug} slug={slug} />
            ))}
          </div>
          {saved.length > 12 && (
            <div className="pagination">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="button secondary"
                disabled={page * 12 >= saved.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <Compass size={46} strokeWidth={0.8} />
          <h2>Let curiosity lead you.</h2>
          <p>
            Save a place from the atlas or a location profile to start your
            collection.
          </p>
          <Link to="/map" className="button brass">
            Explore the atlas <ArrowUpRight size={17} />
          </Link>
        </div>
      )}
    </main>
  );
}

const definitions = [
  [
    "Apparitions",
    "Reported visual experiences interpreted as a person, figure, or presence. The interpretation is a claim; ordinary explanations and the reliability of the account should also be considered.",
  ],
  [
    "Unexplained sounds",
    "Accounts of footsteps, voices, or other sounds without an identified source. Describing a sound as unexplained does not establish a supernatural cause.",
  ],
  [
    "Objects moving",
    "Reports of objects changing position or moving unexpectedly, sometimes described as poltergeist activity. These accounts require context and independent corroboration.",
  ],
  [
    "Unusual sensations",
    "Personal impressions such as a sensed presence, sudden unease, or changes in temperature. These are subjective experiences, not measurements of paranormal activity.",
  ],
  [
    "Lights and shadows",
    "Reports of unusual lights or shadows. Environmental conditions, reflections, and camera artifacts can affect what people observe.",
  ],
];
export function Editorial({
  kind,
}: {
  kind: "cases" | "encyclopedia" | "account" | "about";
}) {
  return (
    <main id="main" className="page-shell editorial-page">
      {kind === "cases" ? (
        <>
          <PageHeading
            eyebrow="The case archive"
            title="Look a little deeper."
            description="A home for careful investigations, historical timelines, and the sources behind the stories."
          />
          <div className="empty-state">
            <BookOpen size={42} strokeWidth={1} />
            <span className="pill">In preparation</span>
            <h2>Good cases take time.</h2>
            <p>
              Our first case files are still being researched. For now, explore
              the documented history and attributed reports in each location
              profile.
            </p>
            <Link to="/locations/stanley-hotel" className="button brass">
              Explore The Stanley Hotel <ArrowUpRight size={16} />
            </Link>
          </div>
        </>
      ) : kind === "account" ? (
        <>
          <PageHeading
            eyebrow="Your place in PHASM"
            title="A community, thoughtfully built."
            description="Accounts and community contributions are planned for a later phase."
          />
          <div className="account-panel">
            <ShieldCheck size={32} />
            <h2>Trust comes first.</h2>
            <p>
              Secure sign-in, submission moderation, privacy controls, and media
              permissions must be ready before community sharing opens. There is
              no public registration yet.
            </p>
            <p>
              You can already save places to a private collection in this
              browser.
            </p>
            <Link to="/saved" className="button brass">
              <Bookmark size={16} />
              Your saved places
            </Link>
          </div>
        </>
      ) : kind === "encyclopedia" ? (
        <>
          <PageHeading
            eyebrow="The phenomena index"
            title="A language for the unexplained."
            description="A concise guide to how PHASM labels reported experiences. These are descriptive categories, not scientific findings."
          />
          <div className="definitions">
            {definitions.map(([title, copy]) => (
              <section key={title}>
                <h2>{title}</h2>
                <p>{copy}</p>
                <Link
                  className="text-link"
                  to={`/map?phenomenon=${encodeURIComponent(title)}`}
                >
                  Explore related places <ArrowRight size={15} />
                </Link>
              </section>
            ))}
          </div>
        </>
      ) : (
        <>
          <PageHeading
            eyebrow="The PHASM approach"
            title="Curiosity, with a little care."
            description="A guide to remarkable places, the histories we can document, and the stories people continue to tell."
          />
          <div className="prose">
            <section>
              <h2>History and folklore deserve different labels.</h2>
              <p>
                Documented history is grounded in the sources linked on each
                profile. Reported paranormal activity is presented as an
                attributed account or local tradition. A story’s longevity does
                not establish that a supernatural event occurred.
              </p>
            </section>
            <section>
              <h2>Three ways a place joins the atlas.</h2>
              <h3>Established location</h3>
              <p>
                A recognized paranormal destination with independently
                documented geographic identity.
              </p>
              <h3>Local legend</h3>
              <p>
                A place connected to regional folklore or oral tradition. A
                professional paranormal investigation is not required.
              </p>
              <h3>Community discovery</h3>
              <p>
                A visitor-proposed location that awaits or has passed editorial
                review. Public suggestions are not open yet.
              </p>
            </section>
            <section id="visit">
              <h2>Visit with respect.</h2>
              <p>
                Never enter private property or restricted areas without
                permission. Follow the official visitor information, respect
                memorials and sensitive histories, and leave every place as you
                found it. Private residences and sensitive sites will use
                approximate locations or remain unpublished.
              </p>
            </section>
            <section>
              <h2>A growing, sourced archive.</h2>
              <p>
                This foundation release contains a small researched collection.
                The initial public-launch goal is at least 50 verified profiles.
                Missing photographs use clearly labeled editorial placeholders;
                no reviews, ratings, or eyewitness accounts have been invented.
              </p>
              <p>
                Community reviews, case files, curated trails, and synced
                collections are planned. They will appear as complete features
                only when they are ready.
              </p>
            </section>
            <Link to="/map" className="button brass">
              Explore the Haunted Atlas <ArrowUpRight size={16} />
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
export function NotFound() {
  return (
    <main id="main" className="page-shell">
      <div className="empty-state">
        <Compass size={48} />
        <Eyebrow>404 · Off the map</Eyebrow>
        <h1>This path has gone quiet.</h1>
        <p>The page you’re looking for isn’t in the archive.</p>
        <Link to="/map" className="button brass">
          Return to the atlas
        </Link>
      </div>
    </main>
  );
}
