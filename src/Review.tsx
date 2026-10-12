import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { LockKeyhole, LogOut, Search, X } from "lucide-react";
import { api } from "./api";
import {
  PageHeading,
  PlaceImage,
  Status,
  classificationLabel,
} from "./components";
import { hasLocationPhotograph, hasMapCoordinates } from "./location";
import type { AtlasGeoJSON, Location, LocationSummary } from "../shared/types";
import { imageLicenseUrl } from "../shared/image-license";
import "./review.css";

const MapCanvas = lazy(() => import("./MapCanvas"));
type ReviewPage = {
  locations: LocationSummary[];
  total: number;
  page: number;
  pageSize: number;
};
type Group = { state: string; status: string; total: number; mapped: number };

// The credential and all draft responses live only in this mounted component.
// No URL, local storage, shared public cache, or public profile route receives them.
export default function Review() {
  const [credential, setCredential] = useState("");
  const [token, setToken] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("draft");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReviewPage>();
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Location>();
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const filters = new URLSearchParams({ q: search, state, status }).toString();

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setResult(undefined);
    setError("");
    api<ReviewPage>(
      `/api/admin/review/locations?${filters}&page=${page}&pageSize=24`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [token, filters, page]);

  useEffect(() => {
    setDetail(undefined);
    setDetailError("");
    if (!token || !selected) return;
    const controller = new AbortController();
    api<{ location: Location }>(
      `/api/admin/review/locations/${encodeURIComponent(selected)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    )
      .then(({ location }) => {
        if (controller.signal.aborted) return;
        setDetail(location);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setDetailError(error.message);
      });
    return () => controller.abort();
  }, [token, selected]);
  useEffect(() => {
    if (detail) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start" });
    }
  }, [detail]);

  const requestFeed = useCallback(
    (path: string, signal: AbortSignal) =>
      api<AtlasGeoJSON>(
        path.replace(/^\/api\/atlas(?=\?|$)/, "/api/admin/review/atlas"),
        {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        },
      ),
    [token],
  );
  const close = () => {
    setToken("");
    setCredential("");
    setGroups([]);
    setResult(undefined);
    setSelected("");
    setDetail(undefined);
    setShowMap(false);
    setError("");
  };
  const changeFilter = (update: () => void) => {
    update();
    setPage(1);
    setSelected("");
  };
  const states = [
    ...new Set(groups.map((group) => group.state).filter(Boolean)),
  ].sort();
  const scopedGroups = groups.filter(
    (group) =>
      (!state || group.state === state) && (!status || group.status === status),
  );
  const scopedMapped = scopedGroups.reduce(
    (total, group) => total + group.mapped,
    0,
  );
  const scopedTotal = scopedGroups.reduce(
    (total, group) => total + group.total,
    0,
  );

  return (
    <main id="main" className="page-shell review-workspace">
      <PageHeading
        eyebrow="Private editorial review"
        title="Review the research."
        description="Browse imported profiles, sources, and map coverage without publishing changes."
      />
      {!token ? (
        <form
          className="admin-login"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const data = await api<{ groups: Group[] }>(
                "/api/admin/review/meta",
                {
                  headers: { Authorization: `Bearer ${credential}` },
                },
              );
              setGroups(data.groups);
              setToken(credential);
              setCredential("");
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Your editorial credential is kept in memory and cleared when you
            reload or lock this workspace.
          </p>
          <label>
            Editorial access token
            <input
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              autoComplete="off"
              minLength={32}
              required
            />
          </label>
          <button className="button brass" disabled={busy}>
            <LockKeyhole size={16} />
            {busy ? "Checking access…" : "Unlock private review"}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="admin-warning">
            Read-only review. Drafts are visible here after authorization; they
            remain excluded from the public archive, search, map, and sitemap.
          </div>
          <div className="review-toolbar">
            <p>
              {groups
                .reduce((sum, group) => sum + group.total, 0)
                .toLocaleString()}{" "}
              total profiles ·{" "}
              {groups
                .filter((group) => group.status === "draft")
                .reduce((sum, group) => sum + group.total, 0)
                .toLocaleString()}{" "}
              drafts
            </p>
            <button className="button secondary" onClick={close}>
              <LogOut size={16} />
              Lock workspace
            </button>
          </div>
          <form
            className="review-filters"
            onSubmit={(event) => {
              event.preventDefault();
              changeFilter(() => setSearch(query));
            }}
          >
            <label>
              Search research
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={160}
                placeholder="Place, city, or state"
              />
            </label>
            <label>
              State
              <select
                aria-label="State"
                value={state}
                onChange={(event) =>
                  changeFilter(() => setState(event.target.value))
                }
              >
                <option value="">All states and countries</option>
                {states.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </label>
            <label>
              Publication status
              <select
                aria-label="Publication status"
                value={status}
                onChange={(event) =>
                  changeFilter(() => setStatus(event.target.value))
                }
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
                <option value="">All statuses</option>
              </select>
            </label>
            <button className="button brass">
              <Search size={16} />
              Search research
            </button>
          </form>
          <div className="review-toolbar">
            <p role="status">
              {result
                ? `${result.total.toLocaleString()} matching profiles`
                : "Loading profiles…"}
              {!search &&
                ` · ${scopedMapped.toLocaleString()} mapped · ${(scopedTotal - scopedMapped).toLocaleString()} not mapped`}
            </p>
            <button
              className="button secondary"
              aria-expanded={showMap}
              onClick={() => setShowMap(!showMap)}
            >
              {showMap ? "Hide review map" : "Show review map"}
            </button>
          </div>
          {showMap && (
            <section className="review-map" aria-label="Private research map">
              <Suspense fallback={<Status loading />}>
                <MapCanvas
                  query={filters}
                  selected={selected}
                  onSelect={setSelected}
                  requestFeed={requestFeed}
                />
              </Suspense>
              <p>
                Only profiles with reviewed coordinates appear. Profiles without
                pins remain in the list.
              </p>
            </section>
          )}
          {selected && (
            <section
              className="review-detail"
              ref={detailRef}
              tabIndex={-1}
              aria-label="Selected research profile"
            >
              <button
                className="button secondary review-close"
                onClick={() => setSelected("")}
              >
                <X size={16} />
                Close profile
              </button>
              {detailError ? (
                <Status error={detailError} />
              ) : !detail ? (
                <Status loading />
              ) : (
                <ReviewDetail location={detail} />
              )}
            </section>
          )}
          {error ? (
            <Status error={error} />
          ) : !result ? (
            <Status loading />
          ) : !result.locations.length ? (
            <div className="empty-state">
              <h2>No research profiles match.</h2>
              <p>Try another place, state, or publication status.</p>
            </div>
          ) : (
            <>
              <div className="review-cards">
                {result.locations.map((location) => (
                  <article className="location-card" key={location.id}>
                    <div className="card-image">
                      <PlaceImage location={location} />
                      {!hasLocationPhotograph(location) && (
                        <span className="image-illustration-label">
                          Illustration · photograph pending
                        </span>
                      )}
                    </div>
                    <div className="card-content">
                      <p className="place-geography">
                        {[location.city, location.state, location.country]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <button
                        className="card-title review-card-title"
                        onClick={() => setSelected(location.slug)}
                      >
                        <h2>{location.name}</h2>
                      </button>
                      <p className="card-summary">{location.summary}</p>
                      <p>
                        {location.status} ·{" "}
                        {classificationLabel(location.classification)}
                      </p>
                      <p className="card-map-note">
                        {hasMapCoordinates(location)
                          ? location.coordinatePrecision === "approximate"
                            ? "Approximate location"
                            : "Reviewed map location"
                          : "Location not mapped"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <nav className="pagination" aria-label="Research pages">
                <button
                  className="button secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page} of {Math.max(1, Math.ceil(result.total / 24))}
                </span>
                <button
                  className="button secondary"
                  disabled={page * 24 >= result.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </nav>
            </>
          )}
        </>
      )}
    </main>
  );
}

function ReviewDetail({ location: p }: { location: Location }) {
  const mapped = hasMapCoordinates(p);
  const licenseUrl = imageLicenseUrl(p.imageLicense, p.imageSource);
  return (
    <article>
      <p className="eyebrow">
        {p.status} · {p.category} · {classificationLabel(p.classification)}
      </p>
      <h2>{p.name}</h2>
      <p>{[p.city, p.state, p.country].filter(Boolean).join(", ")}</p>
      <figure>
        <PlaceImage
          location={p}
          priority
          sizes="(max-width: 760px) 100vw, 900px"
        />
        <figcaption>
          {p.imageCredit} ·{" "}
          {licenseUrl ? (
            <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
              {p.imageLicense}
            </a>
          ) : (
            p.imageLicense
          )}
          {p.imageSource && (
            <>
              {" "}
              ·{" "}
              <a href={p.imageSource} target="_blank" rel="noopener noreferrer">
                Image source
              </a>
            </>
          )}
          {!hasLocationPhotograph(p) && (
            <p>
              This illustration does not depict the location. A verified
              photograph is pending.
            </p>
          )}
        </figcaption>
      </figure>
      <section>
        <h3>The story</h3>
        <p>{p.summary}</p>
      </section>
      <section>
        <h3>Reported hauntings</h3>
        <p className="review-prose">
          {p.reports || "Reported activity is awaiting editorial review."}
        </p>
      </section>
      {p.history && (
        <section>
          <h3>Documented history</h3>
          <p className="review-prose">{p.history}</p>
        </section>
      )}
      <section>
        <h3>Visiting</h3>
        <p>
          Access: {p.access} · Tours: {p.tours}
        </p>
        <p className="review-prose">{p.accessNotes}</p>
        {p.officialUrl && (
          <a href={p.officialUrl} target="_blank" rel="noopener noreferrer">
            Official visitor information
          </a>
        )}
        <p>
          {!mapped
            ? "Location not mapped. Verified coordinates are unavailable; directions are disabled."
            : p.coordinatePrecision === "approximate"
              ? "Approximate location. This pin is not a verified visitor entrance; follow official access guidance."
              : "Reviewed map location. Follow official access guidance."}
        </p>
        {mapped &&
          p.coordinatePrecision === "exact" &&
          p.access === "public" && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Directions to mapped location
            </a>
          )}
      </section>
      <section>
        <h3>Sources and attribution</h3>
        {p.sources.length ? (
          <ul>
            {p.sources.map((source) => (
              <li key={`${source.kind}:${source.url}`}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>{" "}
                <span>({source.kind})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            Source mapping requires editorial review. Consult the import
            provenance report before publication.
          </p>
        )}
      </section>
      <p className="review-identity">
        Stable ID: {p.id} · Slug: {p.slug}
      </p>
    </article>
  );
}
