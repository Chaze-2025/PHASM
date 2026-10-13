import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Map as MapIcon,
} from "lucide-react";
import {
  DIRECTORY_PAGE_SIZE,
  US_STATES,
  findState,
  type DiscoveryResponse,
} from "../shared/discovery";
import type { LocationPage, LocationSummary } from "../shared/types";
import { useApi } from "./api";
import { Eyebrow, LocationCard, PageHeading, Status } from "./components";
import "./discover.css";

const number = new Intl.NumberFormat("en-US");

function Breadcrumbs({ state }: { state?: string }) {
  return (
    <nav className="discovery-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link to="/">Home</Link>
        </li>
        <li>
          {state ? (
            <Link to="/haunted-places">Haunted places</Link>
          ) : (
            <span aria-current="page">Haunted places</span>
          )}
        </li>
        {state && (
          <li>
            <span aria-current="page">{state}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

function StateIndex() {
  const { data, error } = useApi<DiscoveryResponse>("/api/discover");
  const counts = new Map(
    data?.states.map((state) => [state.code, state.count]),
  );
  useEffect(() => {
    document.title = "Haunted Places by State | PHASM";
  }, []);
  return (
    <main id="main" className="page-shell discovery-page">
      <Breadcrumbs />
      <div className="discovery-intro">
        <PageHeading
          eyebrow="The national field guide"
          title="Haunted places, state by state."
          description="Every region has its restless stories. Browse haunted places across all 50 states, follow their histories and ghost lore, and find the places that call to you."
        />
        <Link to="/map" className="button secondary discovery-map-link">
          <MapIcon size={17} strokeWidth={1.5} /> Explore the Haunted Atlas{" "}
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <section
        className="discovery-state-section"
        aria-labelledby="state-index-title"
      >
        <div className="discovery-section-heading">
          <div>
            <Eyebrow>Choose a place to begin</Eyebrow>
            <h2 id="state-index-title">The state index</h2>
          </div>
          <p className="discovery-total" aria-live="polite">
            {data ? `${number.format(data.total)} places` : "50 states"}
            <span>
              {data ? "Across all 50 states" : "One unfolding archive"}
            </span>
          </p>
        </div>
        {error && (
          <p className="discovery-count-note" role="status">
            Place counts are temporarily unavailable. You can still browse by
            state.
          </p>
        )}
        <ol className="discovery-state-grid">
          {US_STATES.map((state, index) => {
            const count = counts.get(state.code);
            return (
              <li key={state.code}>
                <Link to={`/haunted-places/${state.slug}`}>
                  <span className="discovery-state-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="discovery-state-name">
                    {state.name}
                    <span>
                      {count === undefined
                        ? "Explore the archive"
                        : `${number.format(count)} ${count === 1 ? "place" : "places"}`}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={16}
                    strokeWidth={1.3}
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
      <aside className="discovery-field-note">
        <Eyebrow>A note from the archive</Eyebrow>
        <h2>Follow the story. Know the place.</h2>
        <p>
          PHASM brings history and reported hauntings together with source links
          and visiting information. Some map pins mark an approximate area; each
          profile explains what is known. Read the access notes before planning
          a visit.
        </p>
        <Link className="text-link" to="/about">
          Our approach <ArrowRight size={15} />
        </Link>
      </aside>
    </main>
  );
}

function PageLinks({
  slug,
  page,
  total,
}: {
  slug: string;
  page: number;
  total: number;
}) {
  const pages = Math.ceil(total / DIRECTORY_PAGE_SIZE);
  if (pages <= 1) return null;
  const href = (value: number) =>
    `/haunted-places/${slug}${value === 1 ? "" : `?page=${value}`}`;
  const visible = Array.from(new Set([1, page - 1, page, page + 1, pages]))
    .filter((value) => value >= 1 && value <= pages)
    .sort((a, b) => a - b);
  return (
    <nav className="discovery-pagination" aria-label="Location pages">
      <div>
        {page > 1 && (
          <Link className="text-link" to={href(page - 1)} rel="prev">
            <ArrowLeft size={15} /> Previous
          </Link>
        )}
      </div>
      <ol>
        {visible.map((value, index) => (
          <li key={value}>
            {index > 0 && value > visible[index - 1]! + 1 && (
              <span className="discovery-page-gap" aria-hidden="true">
                …
              </span>
            )}
            <Link
              to={href(value)}
              aria-label={`Page ${value}`}
              aria-current={value === page ? "page" : undefined}
            >
              {value}
            </Link>
          </li>
        ))}
      </ol>
      <div>
        {page < pages && (
          <Link className="text-link" to={href(page + 1)} rel="next">
            Next <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </nav>
  );
}

function StatePlaces({ slug }: { slug: string }) {
  const state = findState(slug);
  const [params] = useSearchParams();
  const requestedPage = Number(params.get("page") || 1);
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 100000
      ? requestedPage
      : 1;
  const { data, error, loading } = useApi<LocationPage<LocationSummary>>(
    state
      ? `/api/locations?state=${state.code}&page=${page}&pageSize=${DIRECTORY_PAGE_SIZE}&format=summary`
      : null,
  );
  useEffect(() => {
    document.title = state
      ? `Haunted Places in ${state.name}${page > 1 ? ` — Page ${page}` : ""} | PHASM`
      : "Page Not Found | PHASM";
    window.scrollTo(0, 0);
  }, [state, page]);
  if (!state) {
    return (
      <main id="main" className="page-shell discovery-page">
        <Breadcrumbs />
        <PageHeading
          eyebrow="404 · Off the map"
          title="This path has gone quiet."
          description="That state isn’t in this index. Choose a state to return to the archive."
        />
        <Link className="button secondary" to="/haunted-places">
          Browse all states <ArrowRight size={16} />
        </Link>
      </main>
    );
  }
  return (
    <main id="main" className="page-shell discovery-page">
      <Breadcrumbs state={state.name} />
      <div className="discovery-intro">
        <PageHeading
          eyebrow="The state archive"
          title={`Haunted places in ${state.name}.`}
          description={`Explore ${state.name}’s haunted places and local legends. Open a profile to read its history, reported encounters, sources, and visiting information.`}
        />
        <Link
          to={`/map?state=${state.code}`}
          className="button secondary discovery-map-link"
        >
          <MapIcon size={17} strokeWidth={1.5} /> Explore {state.name} on the
          map <ArrowUpRight size={16} />
        </Link>
      </div>
      <section aria-labelledby="state-places-title" aria-busy={loading}>
        <div className="discovery-results-heading">
          <h2 id="state-places-title">Places in the archive</h2>
          {data && (
            <p>
              {number.format(data.total)}{" "}
              {data.total === 1 ? "place" : "places"}
              {data.total > DIRECTORY_PAGE_SIZE && (
                <>
                  {" "}
                  · Page {page} of {Math.ceil(data.total / DIRECTORY_PAGE_SIZE)}
                </>
              )}
            </p>
          )}
        </div>
        {loading ? (
          <Status loading />
        ) : error ? (
          <Status error={error} />
        ) : data?.locations.length ? (
          <>
            <div className="location-grid">
              {data.locations.map((location) => (
                <LocationCard key={location.id} location={location} />
              ))}
            </div>
            <PageLinks slug={state.slug} page={page} total={data.total} />
          </>
        ) : (
          <div className="empty-state">
            <h2>
              {page > 1
                ? "You’ve reached the end of this archive."
                : "More stories are waiting to be uncovered."}
            </h2>
            <p>
              {page > 1
                ? "Return to the first page to explore the places in this state."
                : "There are no published places in this state yet. Explore the rest of the archive for your next discovery."}
            </p>
            <Link
              className="button secondary"
              to={
                page > 1 ? `/haunted-places/${state.slug}` : "/haunted-places"
              }
            >
              {page > 1 ? `Browse ${state.name}` : "Browse all states"}{" "}
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <div className="discovery-return">
        <Link className="text-link" to="/haunted-places">
          <ArrowLeft size={16} /> All 50 states
        </Link>
        <Link className="text-link" to="/about#visit">
          Before you visit <ArrowUpRight size={15} />
        </Link>
      </div>
    </main>
  );
}

export default function Discover() {
  const { stateSlug } = useParams<{ stateSlug: string }>();
  return stateSlug ? <StatePlaces slug={stateSlug} /> : <StateIndex />;
}
