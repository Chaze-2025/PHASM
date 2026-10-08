import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  MapPin,
  BookOpen,
  ExternalLink,
  Route,
  ShieldCheck,
  ChevronRight,
  Map,
  Camera,
  AudioLines,
} from "lucide-react";
import { useApi } from "./api";
import type { Location } from "../shared/types";
import {
  LocationCard,
  Eyebrow,
  Status,
  SaveButton,
  PlaceImage,
  classificationLabel,
} from "./components";

const dossierSections = [
  ["reports", "Hauntings"],
  ["history", "History"],
  ["gallery", "Photographs"],
  ["experiences", "Experiences"],
  ["sources", "Sources"],
  ["visit", "Visiting"],
];

function DossierHeading({
  number,
  label,
  title,
}: {
  number: string;
  label: string;
  title: string;
}) {
  return (
    <header className="dossier-heading">
      <span className="dossier-number" aria-hidden="true">
        {number}
      </span>
      <div>
        <Eyebrow>{label}</Eyebrow>
        <h2>{title}</h2>
      </div>
    </header>
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
      document.title = `${p.name} — Hauntings, History & Visiting Guide | PHASM`;
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

  const geography = [p.city, p.state, p.country].filter(Boolean).join(", ");
  const hasPhotograph = Boolean(
    p.image &&
    !p.image.includes("archive-placeholder.svg") &&
    p.imageLicense !== "PHASM original illustration",
  );
  return (
    <main id="main" className="profile profile-page">
      <nav className="breadcrumb section" aria-label="Breadcrumb">
        <Link to="/">Discover</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link to="/map">Haunted Atlas</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page">{p.name}</span>
      </nav>

      <section className="profile-hero" aria-labelledby="location-title">
        <PlaceImage location={p} className="profile-image" priority />
        <div className="profile-photographic-frame" aria-hidden="true" />
        <div className="profile-hero-top section">
          <span className="profile-dossier-label">
            <span className="dossier-registration" aria-hidden="true" />
            PHASM / Haunted location dossier
          </span>
          <span className="pill">{classificationLabel(p.classification)}</span>
        </div>
        <div className="profile-hero-copy">
          <span className="profile-category">{p.category}</span>
          <h1 id="location-title">{p.name}</h1>
          <p>
            <MapPin size={18} aria-hidden="true" />
            {geography}
          </p>
        </div>
        <a className="profile-photo-link" href="#gallery">
          <Camera size={15} aria-hidden="true" />
          {hasPhotograph ? "Photograph & credit" : "Illustration & credit"}
        </a>
      </section>

      <div className="profile-subnav section">
        <p className="profile-location-note">
          <MapPin size={17} aria-hidden="true" />
          {p.coordinatePrecision === "approximate"
            ? "Approximate location"
            : "On the Haunted Atlas"}
        </p>
        <SaveButton slug={p.slug} label />
      </div>

      <nav
        className="dossier-navigation section"
        aria-label="Location sections"
      >
        {dossierSections.map(([id, label], index) => (
          <a href={`#${id}`} key={id}>
            <span aria-hidden="true">0{index + 1}</span>
            {label}
          </a>
        ))}
      </nav>

      <div className="profile-layout section">
        <article className="profile-article">
          <section
            id="story"
            className="dossier-introduction"
            aria-labelledby="story-title"
          >
            <h2 id="story-title" className="eyebrow">
              <span aria-hidden="true" />
              The Story
            </h2>
            <p className="profile-intro">{p.summary}</p>
            <nav
              className="dossier-reading-key"
              aria-label="Explore this story"
            >
              <a href="#reports">
                <AudioLines size={20} strokeWidth={1.25} aria-hidden="true" />
                <span>
                  <small>The stories that linger</small>Reported hauntings
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <a href="#history">
                <BookOpen size={19} strokeWidth={1.25} aria-hidden="true" />
                <span>
                  <small>The people & the place</small>Documented history
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </nav>
          </section>

          <section id="reports" className="dossier-section dossier-reports">
            <DossierHeading
              number="01"
              label="Stories of the unexplained"
              title="The Hauntings"
            />
            <p className="dossier-report-narrative">{p.reports}</p>
            {!!p.phenomena.length && (
              <div className="dossier-phenomena">
                <span className="dossier-small-label">
                  Explore these phenomena
                </span>
                <div className="tag-list">
                  {p.phenomena.map((tag) => (
                    <Link
                      key={tag}
                      to={`/map?phenomenon=${encodeURIComponent(tag)}`}
                    >
                      <AudioLines
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      {tag}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section id="history" className="dossier-section dossier-history">
            <DossierHeading
              number="02"
              label="The people & the place"
              title="The History"
            />
            <p>{p.history}</p>
            <a className="dossier-source-link" href="#sources">
              Explore the sources <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </section>

          <section id="gallery" className="dossier-section dossier-gallery">
            <DossierHeading
              number="03"
              label="The visual record"
              title="A sense of place."
            />
            <figure className="gallery-photo">
              <div className="gallery-photograph-mount">
                <PlaceImage location={p} className="profile-image" />
                <span className="gallery-plate-label">
                  {hasPhotograph ? "Location photograph" : "Photograph pending"}
                </span>
              </div>
              <figcaption>
                <span className="gallery-description">
                  {p.imageAlt || `${p.name} — photograph pending`}
                </span>
                {hasPhotograph && (
                  <span className="gallery-treatment">
                    Contemporary location photography · original colors.
                  </span>
                )}
                <span className="gallery-credit">
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
                  )}
                </span>
                {p.imageSource && (
                  <a
                    className="gallery-original"
                    href={p.imageSource}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View original photograph{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                )}
              </figcaption>
            </figure>
          </section>

          <section
            id="experiences"
            className="dossier-section dossier-experiences"
          >
            <DossierHeading
              number="04"
              label="A place for your story"
              title="Visitor Experiences"
            />
            <div className="empty-experiences">
              <BookOpen size={27} strokeWidth={1.2} aria-hidden="true" />
              <div>
                <span className="dossier-small-label">A future chapter</span>
                <h3>Have you experienced something here?</h3>
                <p>
                  This future chapter will bring together stories from the PHASM
                  community. An unexpected encounter, a lingering feeling, or a
                  quiet visit—your experience will be welcome.
                </p>
                <span className="experience-status">
                  <span aria-hidden="true" />
                  Submissions are not open yet
                </span>
              </div>
            </div>
          </section>

          <section id="sources" className="dossier-section dossier-sources">
            <DossierHeading
              number="05"
              label="Trace the story"
              title="Sources & further reading."
            />
            <ol className="source-list">
              {p.sources.map((source, i) => (
                <li key={source.url + i}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    <span>
                      <small>
                        {source.kind === "reports"
                          ? "Paranormal reports"
                          : source.kind === "history"
                            ? "Historical source"
                            : "Visitor information"}
                      </small>
                      {source.title}
                    </span>
                    <ArrowUpRight size={19} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ol>
            <p className="dossier-updated">
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

        <aside id="visit" className="visit-card" aria-labelledby="visit-title">
          <div className="visit-card-top">
            <span className="dossier-small-label">
              <span aria-hidden="true">06 / </span>Before you go
            </span>
            <Map size={23} strokeWidth={1.1} aria-hidden="true" />
          </div>
          <h2 id="visit-title">Plan Your Visit</h2>
          <p className="visit-card-location">
            {p.city}
            {p.state ? `, ${p.state}` : `, ${p.country}`}
          </p>
          <dl>
            <div>
              <dt>
                <MapPin size={16} aria-hidden="true" />
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
                <Route size={16} aria-hidden="true" />
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
              className="button brass dossier-visitor-action"
              href={p.officialUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official visitor information{" "}
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          )}
          <Link
            className="button secondary"
            to={`/map?q=${encodeURIComponent(p.name)}`}
          >
            <Map size={17} aria-hidden="true" />
            View on the atlas
          </Link>
          {p.access !== "private" && p.coordinatePrecision === "exact" && (
            <a
              className="text-link"
              href={`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Get directions <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          )}
          <div className="respect-note">
            <ShieldCheck size={19} aria-hidden="true" />
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
              <h2>There is always another story.</h2>
            </div>
            <Link to="/map" className="text-link">
              Return to the atlas <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
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
