import { useState } from "react";
import { LockKeyhole, LogOut, Plus, Save, Search } from "lucide-react";
import { api } from "./api";
import { PageHeading } from "./components";
import { categories, type Location, type LocationPage } from "../shared/types";
const emptyLocation = (): Location => ({
  id: crypto.randomUUID(),
  slug: "",
  name: "",
  city: "",
  state: "",
  country: "",
  region: "",
  latitude: null,
  longitude: null,
  category: "Other",
  classification: "community-discovery",
  summary: "",
  history: "",
  reports: "",
  phenomena: [],
  access: "unknown",
  tours: "unknown",
  accessNotes: "Access has not been verified. Do not enter without permission.",
  officialUrl: "",
  sources: [],
  image: "/images/archive-placeholder.svg",
  imageAlt: "Editorial placeholder — photograph pending.",
  imageCredit: "PHASM editorial placeholder",
  imageLicense: "PHASM",
  imageSource: "",
  status: "draft",
  coordinatePrecision: "withheld",
  featured: false,
  updatedAt: new Date().toISOString(),
});
export default function Admin() {
  const [token, setToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [records, setRecords] = useState<Location[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [record, setRecord] = useState<Location | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [sources, setSources] = useState("[]");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (nextPage = 1) => {
    const result = await api<LocationPage>(
      `/api/admin/locations?page=${nextPage}&pageSize=50&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    setRecords(result.locations);
    setTotal(result.total);
    setPage(nextPage);
    setAuthorized(true);
  };
  const edit = (item: Location, newRecord = false) => {
    setRecord({ ...item });
    setSources(JSON.stringify(item.sources, null, 2));
    setTags(item.phenomena.join(", "));
    setIsNew(newRecord);
    setError("");
    setMessage("");
  };
  const update = <K extends keyof Location>(key: K, value: Location[K]) =>
    setRecord((previous) => (previous ? { ...previous, [key]: value } : null));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let parsed;
      try {
        parsed = JSON.parse(sources);
      } catch {
        throw new Error("Sources must be a valid JSON array.");
      }
      const body = {
        ...record,
        sources: parsed,
        phenomena: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const result = await api<{ location: Location }>(
        `/api/admin/locations${isNew ? "" : `/${record.id}`}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      edit(result.location);
      await load(page);
      setMessage(
        `Saved ${result.location.name} as ${result.location.status}. Server record updated ${new Date(result.location.updatedAt).toLocaleTimeString()}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stringField = (
    key: keyof Location,
    label: string,
    required = true,
    full = false,
    type = "text",
  ) => (
    <label key={key} className={full ? "full" : ""}>
      {label}
      <input
        type={type}
        required={required}
        value={String(record?.[key] ?? "")}
        onChange={(e) => update(key, e.target.value as never)}
      />
    </label>
  );
  const selectField = (
    key: keyof Location,
    label: string,
    options: string[],
  ) => (
    <label key={key}>
      {label}
      <select
        value={String(record?.[key] ?? "")}
        onChange={(e) => update(key, e.target.value as never)}
      >
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  return (
    <main id="main" className="page-shell">
      <PageHeading
        eyebrow="Private editorial workspace"
        title="The editorial desk."
        description="Manage the archive with clear sources, careful labels, and considered publication."
      />
      {!authorized ? (
        <form
          className="admin-login"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            This workspace requires a server-configured editorial credential. It
            is held only in memory for this session and cleared when you reload
            or sign out.
          </p>
          <label>
            Editorial access token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              required
              minLength={32}
            />
          </label>
          <button className="button brass" disabled={busy}>
            <LockKeyhole size={16} />
            {busy ? "Checking access…" : "Unlock editorial desk"}
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="admin-warning">
            Editorial foundation: location editing and publication are
            available. Public suggestions, review moderation, media uploads, and
            multi-editor accounts remain closed. Published changes become
            visible immediately.
          </div>
          <div className="admin-toolbar">
            <button
              className="button brass"
              onClick={() => edit(emptyLocation(), true)}
            >
              <Plus size={16} />
              New location
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setAuthorized(false);
                setToken("");
                setRecords([]);
                setRecord(null);
                setError("");
              }}
            >
              <LogOut size={16} />
              Lock workspace
            </button>
          </div>
          <div className="admin-layout">
            <aside className="admin-sidebar">
              <form
                className="atlas-search"
                style={{ width: "100%", marginBottom: 10 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await load(1);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <input
                  aria-label="Search editorial records"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search records"
                />
                <button className="icon-button" aria-label="Search">
                  <Search size={16} />
                </button>
              </form>
              {records.map((l) => (
                <button
                  key={l.id}
                  className={record?.id === l.id ? "active" : ""}
                  onClick={() => edit(l)}
                >
                  {l.name}
                  <small>
                    {l.status} · {l.country}
                  </small>
                </button>
              ))}
              {total > 50 && (
                <div className="pagination">
                  <button
                    disabled={page <= 1}
                    className="icon-button"
                    onClick={() => load(page - 1)}
                  >
                    Previous
                  </button>
                  <span>{page}</span>
                  <button
                    disabled={page * 50 >= total}
                    className="icon-button"
                    onClick={() => load(page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </aside>
            {record ? (
              <form className="editor-form" onSubmit={save}>
                <h2>{isNew ? "Add a place" : record.name}</h2>
                <div className="form-grid">
                  {stringField("name", "Location name")}
                  {stringField("slug", "Shareable URL slug")}
                  {stringField("city", "City", false)}
                  {stringField("state", "State / province", false)}
                  {stringField("country", "Country")}
                  {stringField("region", "Region")}
                  {(["latitude", "longitude"] as const).map((key) => (
                    <label key={key}>
                      {key === "latitude" ? "Latitude" : "Longitude"}
                      <input
                        type="number"
                        step="any"
                        min={key === "latitude" ? -90 : -180}
                        max={key === "latitude" ? 90 : 180}
                        required={record.coordinatePrecision !== "withheld"}
                        disabled={record.coordinatePrecision === "withheld"}
                        value={record[key] ?? ""}
                        onChange={(e) =>
                          update(
                            key,
                            e.target.value === ""
                              ? null
                              : e.target.valueAsNumber,
                          )
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Map pin precision
                    <select
                      value={record.coordinatePrecision}
                      onChange={(e) => {
                        const coordinatePrecision = e.target
                          .value as Location["coordinatePrecision"];
                        setRecord((previous) =>
                          previous
                            ? {
                                ...previous,
                                coordinatePrecision,
                                ...(coordinatePrecision === "withheld"
                                  ? { latitude: null, longitude: null }
                                  : {}),
                              }
                            : null,
                        );
                      }}
                    >
                      <option value="exact">Exact</option>
                      <option value="approximate">Approximate</option>
                      <option value="withheld">
                        Withheld — no public map pin
                      </option>
                    </select>
                  </label>
                  {record.coordinatePrecision === "withheld" && (
                    <p className="full">
                      This profile remains searchable by its city and state
                      without a map pin. Choose exact or approximate precision
                      when verified coordinates are available.
                    </p>
                  )}
                  <label>
                    Category
                    <input
                      list="location-categories"
                      required
                      value={record.category}
                      onChange={(e) => update("category", e.target.value)}
                    />
                    <datalist id="location-categories">
                      {categories.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                  </label>
                  {selectField("classification", "Editorial classification", [
                    "established",
                    "local-legend",
                    "community-discovery",
                  ])}
                  {selectField("status", "Publication status", [
                    "draft",
                    "published",
                    "archived",
                  ])}
                  {(
                    ["summary", "history", "reports", "accessNotes"] as const
                  ).map((key) => (
                    <label className="full" key={key}>
                      {
                        {
                          summary: "Short description",
                          history: "Documented history",
                          reports:
                            "Reported paranormal activity (attribute every claim)",
                          accessNotes: "Public access and visitor guidance",
                        }[key]
                      }
                      <textarea
                        required={
                          key === "summary" ||
                          key === "accessNotes" ||
                          (key === "reports" && record.status === "published")
                        }
                        value={record[key]}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    </label>
                  ))}
                  <label className="full">
                    Phenomenon tags, separated by commas
                    <input
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                    />
                  </label>
                  {selectField("access", "Public accessibility", [
                    "public",
                    "restricted",
                    "private",
                    "unknown",
                  ])}
                  {selectField("tours", "Tour availability", [
                    "yes",
                    "no",
                    "unknown",
                  ])}
                  {stringField(
                    "officialUrl",
                    "Official HTTPS website",
                    false,
                    true,
                    "url",
                  )}
                  <label className="full">
                    Sources (JSON array of title, url, kind: history / reports /
                    visiting)
                    <textarea
                      rows={9}
                      value={sources}
                      onChange={(e) => setSources(e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  {stringField(
                    "image",
                    "Image URL or local asset path",
                    true,
                    true,
                  )}
                  {stringField(
                    "imageAlt",
                    "Image alternative text",
                    true,
                    true,
                  )}
                  {stringField(
                    "imageCredit",
                    "Photographer / attribution",
                    true,
                    true,
                  )}
                  {stringField("imageLicense", "Image license")}
                  {stringField("imageSource", "Image source URL", false)}
                  <label className="checkbox full">
                    <input
                      type="checkbox"
                      checked={record.featured}
                      onChange={(e) => update("featured", e.target.checked)}
                    />
                    Featured in the archive
                  </label>
                </div>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                {message && (
                  <p role="status" className="form-success">
                    {message}
                  </p>
                )}
                <button type="submit" className="button brass" disabled={busy}>
                  <Save size={15} />
                  {busy ? "Saving…" : "Save editorial changes"}
                </button>
              </form>
            ) : (
              <div className="empty-state">
                <LockKeyhole size={35} />
                <h2>The archive is in your hands.</h2>
                <p>
                  Select a location to edit, or create a new draft. Published
                  profiles need reported-activity sources and a historical
                  source for any history included.
                </p>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
