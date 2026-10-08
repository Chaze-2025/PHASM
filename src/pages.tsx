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
      <p>
        We can’t open this saved place right now. Try again later or explore
        another mystery.
      </p>
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
        Saved in this browser · No account required · Not synced between devices
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
    "A figure in an empty doorway. A familiar face glimpsed for a moment. Apparition stories describe spirits taking visible form, from fleeting outlines to figures that seem as solid as anyone else in the room.",
  ],
  [
    "Unexplained sounds",
    "Footsteps along a deserted passage, a voice from an empty room, music heard after everyone has gone. Unexplained sounds are among the most enduring threads in haunted-place lore.",
  ],
  [
    "Objects moving",
    "Doors opening on their own, belongings found somewhere unexpected, or an object shifting in plain sight. Stories of restless objects are often woven into poltergeist lore and tales of mischievous spirits.",
  ],
  [
    "Unusual sensations",
    "The feeling of being watched. A sudden chill. The sense that someone has just entered an empty room. Some encounters are remembered for what a visitor felt, even when nothing was seen or heard.",
  ],
  [
    "Lights and shadows",
    "A light drifting across a dark landscape or a shadow passing at the edge of sight. Such glimpses run through ghost stories, from wandering lights outdoors to shadowy figures in quiet interiors.",
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
            description="Step further into the hauntings: the people, the encounters, and the histories that connect them."
          />
          <div className="empty-state">
            <BookOpen size={42} strokeWidth={1} />
            <span className="pill">In preparation</span>
            <h2>More mysteries are taking shape.</h2>
            <p>
              Our first case files are still being researched. Until they’re
              ready, follow the ghost stories and histories in our location
              profiles, beginning with The Stanley Hotel.
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
            title="Every visit has a story."
            description="A future home for your encounters, memories, and conversations about the unexplained. Accounts and community sharing are not open yet."
          />
          <div className="account-panel">
            <ShieldCheck size={32} />
            <h2>A place for your experience.</h2>
            <p>
              An unexpected encounter or a wonderfully quiet night: both belong
              here. We’re preparing a welcoming space to share, with moderation
              and privacy protections in place before contributions open.
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
            description="Meet the apparitions, strange sounds, and fleeting sensations that weave their way through ghost stories. Follow a thread to the places where it lingers."
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
            title="There is more to the story."
            description="PHASM is for everyone drawn to haunted places, local legends, and the feeling that a place holds something more."
          />
          <div className="prose">
            <section>
              <h2>Follow a haunting to its roots.</h2>
              <p>
                Behind every haunted place are people, memories, and stories
                passed from one visitor to the next. We bring its history and
                ghost lore together, name the storytellers where we can, and
                link to the sources so you can follow your curiosity further.
              </p>
            </section>
            <section>
              <h2>Three ways a place joins the atlas.</h2>
              <h3>Established location</h3>
              <p>
                A recognized haunted destination whose location and identity are
                documented in independent sources.
              </p>
              <h3>Local legend</h3>
              <p>
                A place kept alive in regional folklore or oral tradition, from
                a quiet country road to a familiar building with a story few
                outsiders know.
              </p>
              <h3>Community discovery</h3>
              <p>
                A place brought to PHASM by a visitor and reviewed by our
                editors before joining the atlas. Public suggestions are not
                open yet.
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
              <h2>A world of stories to discover.</h2>
              <p>
                The atlas begins with a small, researched collection of haunted
                places. Each profile brings together its history, haunting
                traditions, and practical visiting information. Photographs have
                source credits, and places awaiting photography use clearly
                labeled illustrations.
              </p>
              <p>
                Community stories, case files, haunted trails, and collections
                that travel between devices are planned. For now, explore the
                atlas and save the places that call to you in this browser.
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
