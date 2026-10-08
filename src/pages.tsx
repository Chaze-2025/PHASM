import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Compass,
  BookOpen,
  Bookmark,
  Camera,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { useApi, useSaved } from "./api";
import type { Location } from "../shared/types";
import { LocationCard, PageHeading, Status, Eyebrow } from "./components";
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
