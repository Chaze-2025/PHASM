import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Location, Source } from "../shared/types";
import { identityKey, safeUrl, validateLocation } from "../worker/validation";

/** Bump whenever a field decision changes; resume must match this version. */
export const NATIONWIDE_ADAPTER_VERSION = "1.0.1";
export const PLACEHOLDER = "/images/location-placeholder.svg";
type ObjectValue = Record<string, unknown>;
export type Disposition =
  "created" | "updated" | "unchanged" | "conflicted" | "rejected" | "deferred";
export interface ReviewWarning {
  code: string;
  field: string;
  message: string;
}
export interface FieldDecision {
  field: string;
  action: string;
  basis: string;
  candidate?: unknown;
}
export interface SourceAssociation {
  field: string;
  namespace: string;
  sourceId: string | null;
  url: string;
  kind: Source["kind"] | "geography" | "media" | "unmapped";
  original: unknown;
}
export interface NationwideRecordPlan {
  researchId: string;
  appId: string;
  sourceFile: string;
  recordPointer: string;
  baseline: boolean;
  disposition: Disposition;
  beforeHash: string | null;
  afterHash: string | null;
  nextLocation?: Location;
  warnings: ReviewWarning[];
  fieldDecisions: FieldDecision[];
  readiness: {
    importValid: boolean;
    /** Mechanically complete research candidate, never editorial approval. */
    contentReady: boolean;
    imageReady: boolean;
    published: boolean;
    coordinate: "preserved" | "approximate" | "withheld";
  };
  sidecar: {
    index: ObjectValue;
    originalRecord: unknown;
    sourceAssociations: SourceAssociation[];
    editorialItems: unknown[];
    /** All research (including unsupported fields) is retained verbatim above. */
    retainedDetail: string[];
  };
}
export interface NationwidePlan {
  version: string;
  inputFingerprint: string;
  inputFiles: { path: string; sha256: string }[];
  records: NationwideRecordPlan[];
  locations: Location[];
  pilotIds: string[];
  summary: Record<string, number>;
  audits: { duplicate: unknown[]; border: unknown[]; editorial: unknown[] };
}
export interface NationwideOptions {
  selectedIds?: string[];
  updatedAt?: string;
}

export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson((value as ObjectValue)[key])}`,
    )
    .join(",")}}`;
}
export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const string = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).map(string).filter(Boolean);
const first = (...values: unknown[]) => values.map(string).find(Boolean) || "";
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const text = (value: unknown): string =>
  typeof value === "string"
    ? value.trim()
    : Array.isArray(value)
      ? value.map(text).filter(Boolean).join("\n\n")
      : string(object(value).text);
const joinText = (...values: unknown[]): string =>
  unique(values.map(text).filter(Boolean)).join("\n\n");
const normalized = (value: string) =>
  value.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();

/** RFC 6901, including ~1 and ~0; never traverse an object's prototype. */
export function resolveJsonPointer(
  document: unknown,
  pointer: string,
): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/"))
    throw new Error(`Invalid JSON pointer: ${pointer}`);
  let value: unknown = document;
  for (const encoded of pointer.slice(1).split("/")) {
    if (/~(?![01])/u.test(encoded))
      throw new Error(`Invalid JSON pointer escape: ${pointer}`);
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      throw new Error(`Unresolved JSON pointer: ${pointer}`);
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
      throw new Error(`Invalid JSON array pointer: ${pointer}`);
    value = (value as ObjectValue)[key];
  }
  return value;
}

/** Parse once per immutable artifact, confining all reads beneath the input root. */
class InputReader {
  private cache = new Map<string, unknown>();
  readonly files = new Map<string, string>();
  readonly root: string;
  constructor(root: string) {
    this.root = realpathSync(root);
  }
  checksumFingerprint(): string {
    return createHash("sha256")
      .update(readFileSync(resolve(this.root, "CHECKSUMS.sha256")))
      .digest("hex");
  }
  read(path: string): unknown {
    if (this.cache.has(path)) return this.cache.get(path);
    if (isAbsolute(path) || path.includes("\\"))
      throw new Error(`Unsafe input path: ${path}`);
    const actual = realpathSync(resolve(this.root, path));
    const rel = relative(this.root, actual);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error(`Input path leaves package: ${path}`);
    const bytes = readFileSync(actual);
    this.files.set(path, createHash("sha256").update(bytes).digest("hex"));
    const value = JSON.parse(bytes.toString("utf8"));
    this.cache.set(path, value);
    return value;
  }
}

interface SourceEntry {
  namespace: string;
  sourceId: string;
  raw: ObjectValue;
  url: string;
}
class SourceResolver {
  private scoped = new Map<string, SourceEntry[]>();
  private baseline = new Map<string, SourceEntry[]>();
  constructor(index: unknown[], baselineSources: unknown[]) {
    for (const item of index) {
      const entry = object(item),
        raw = object(entry.original_record);
      const namespace = `${string(entry.package)}/${string(entry.state_namespace)}`;
      const value = {
        namespace,
        sourceId: first(entry.source_id, raw.source_id, raw.id),
        raw,
        url: first(entry.source_url, raw.url),
      };
      const key = `${namespace}/${value.sourceId}`;
      this.scoped.set(key, [...(this.scoped.get(key) || []), value]);
    }
    for (const source of baselineSources) {
      const raw = object(source),
        sourceId = first(raw.source_id, raw.id);
      const value = {
        namespace: "baseline",
        sourceId,
        raw,
        url: string(raw.url),
      };
      this.baseline.set(sourceId, [
        ...(this.baseline.get(sourceId) || []),
        value,
      ]);
    }
  }
  forRecord(row: ObjectValue, raw: ObjectValue) {
    const [_, pack] = string(row.source_file).split("/");
    const state = normalized(string(row.state)).replace(/ /g, "-");
    const embedded = array(raw.sources).map((entry, i) => ({
      namespace: `${pack}/${state}/embedded`,
      sourceId: first(object(entry).source_id, object(entry).id) || `url-${i}`,
      raw: object(entry),
      url: first(object(entry).url, object(entry).source_url),
    }));
    const lookup = (id: string): SourceEntry | null => {
      const tiers = [
        embedded.filter((entry) => entry.sourceId === id),
        this.scoped.get(`${pack}/${state}/${id}`) || [],
        this.scoped.get(`${pack}/*/${id}`) || [],
        this.baseline.get(id) || [],
      ];
      for (const entries of tiers) {
        if (!entries.length) continue;
        const relevant = entries.filter(
          (entry) =>
            !entry.raw.research_id || entry.raw.research_id === row.research_id,
        );
        const candidates = relevant.length ? relevant : entries;
        if (new Set(candidates.map((entry) => entry.url)).size !== 1)
          return null;
        return candidates[0];
      }
      return null;
    };
    return { embedded, lookup, namespace: `${pack}/${state}` };
  }
}

function roleKinds(raw: ObjectValue): SourceAssociation["kind"][] {
  const labels = normalized(
    [
      text(raw.roles),
      text(raw.role),
      text(raw.evidence),
      string(raw.source_type),
    ].join(" "),
  );
  const title = normalized(string(raw.title));
  // A file-license page or selected image is not haunting evidence, even when
  // an inherited blanket 'story/location' list was attached to every link.
  if (
    /commons\.wikimedia\.org\/wiki\/(?:File|Category):/i.test(string(raw.url))
  )
    return ["media"];
  if (
    /photo|image|licen[sc]e|commons/.test(labels) &&
    !/history|haunt|folklore|story|paranormal|report|visit|access|current.status|operator|geograph|location|identity/.test(
      labels,
    )
  )
    return ["media"];
  if (
    /^(plan your visit|reservations|booking)|official (booking|reservations)|access \/ current status|visitor home page/.test(
      title,
    )
  )
    return ["visiting"];
  const kinds: SourceAssociation["kind"][] = [];
  if (/histor|chronolog/.test(labels)) kinds.push("history");
  if (
    /\bstory\b|haunt|folklore|paranormal|report|legend|encounter|tradition/.test(
      labels,
    )
  )
    kinds.push("reports");
  if (
    /visit|access|admission|operator|current.status|booking|tour/.test(labels)
  )
    kinds.push("visiting");
  if (/geograph|coordinate|map|location|identity/.test(labels))
    kinds.push("geography");
  if (/photo|image|licen[sc]e/.test(labels)) kinds.push("media");
  return kinds.length ? unique(kinds) : ["unmapped"];
}

function categoryOf(value: string): string {
  const lower = normalized(value);
  if (/ghost town|town ruins|mining settlement/.test(lower))
    return "Ghost town";
  if (/cemeter|grave|burial|churchyard/.test(lower)) return "Cemetery";
  if (/castle|palace/.test(lower)) return "Castle";
  if (
    /hotel|\binn\b|motel|lodg|bed and breakfast|guesthouse|resort/.test(lower)
  )
    return "Hotel";
  if (/prison|\bjail\b|penitentiary/.test(lower)) return "Prison";
  if (/hospital|sanatori|infirmary|care institution|care facility/.test(lower))
    return "Hospital";
  if (/theat|cinema|opera house|performance|auditorium/.test(lower))
    return "Theater";
  if (/road|bridge|tunnel|rail crossing|underpass/.test(lower))
    return "Road or bridge";
  if (
    /house|mansion|estate|manor|cottage|homestead/.test(lower) &&
    !/courthouse|lighthouse|firehouse/.test(lower)
  )
    return "Historic house";
  if (
    /natural|park|outdoor|cave|mountain|beach|forest|lake|river|waterfall|springs|island|landscape|woodland|trail|tree|overlook|canyon|wildlife|nature/.test(
      lower,
    )
  )
    return "Natural landmark";
  return "Other";
}
function accessOf(value: string): Location["access"] {
  const lower = normalized(value);
  if (/unknown|unconfirmed|unverified|no confirmed/.test(lower) || !lower)
    return "unknown";
  if (
    /private|occupied.*residence/.test(lower) &&
    !/booking|appointment|tour/.test(lower)
  )
    return "private";
  if (
    /permission|appointment|closed|closure|tour|ticket|event|limited|seasonal|members.only|exterior|booking|reservation/.test(
      lower,
    )
  )
    return "restricted";
  if (/public|commercial|operating|overnight lodging/.test(lower))
    return "public";
  return "unknown";
}
function phenomenaOf(
  raw: unknown,
  warn: (code: string, field: string, message: string) => void,
): string[] {
  const mapped = strings(raw).flatMap((value) => {
    const lower = normalized(value);
    if (
      /sound|voice|footstep|laugh|cry|cries|scream|music|knock|noise|hoofbeat/.test(
        lower,
      )
    )
      return ["Unexplained sounds"];
    if (/object|moving|poltergeist/.test(lower)) return ["Objects moving"];
    if (/light|shadow|mist|camera|photograph/.test(lower))
      return ["Lights and shadows"];
    if (
      /apparition|ghost|spectral|phantom (worker|soldier|vehicle|hitchhiker)|vanishing passenger|woman in white|spirit encounter|named resident/.test(
        lower,
      )
    )
      return ["Apparitions"];
    if (
      /scent|smell|perfume|fragrance|cold|sens|touch|presence|impression/.test(
        lower,
      )
    )
      return ["Unusual sensations"];
    warn(
      "phenomenon-retained-in-sidecar",
      "phenomena",
      `No exact public tag mapping for: ${value}`,
    );
    return [];
  });
  return unique(mapped);
}

function adaptRecord(
  row: ObjectValue,
  raw: ObjectValue,
  resolver: SourceResolver,
  updatedAt: string,
): NationwideRecordPlan {
  const researchId = string(row.research_id),
    appId = first(row.preserve_app_id, row.canonical_site_id, researchId);
  const warnings: ReviewWarning[] = [],
    fieldDecisions: FieldDecision[] = [],
    sourceAssociations: SourceAssociation[] = [];
  const warn = (code: string, field: string, message: string) =>
    warnings.push({ code, field, message });
  const plan: NationwideRecordPlan = {
    researchId,
    appId,
    sourceFile: string(row.source_file),
    recordPointer: string(row.record_pointer),
    baseline: row.baseline_match === true,
    disposition: "created",
    beforeHash: null,
    afterHash: null,
    warnings,
    fieldDecisions,
    readiness: {
      importValid: false,
      contentReady: false,
      imageReady: false,
      published: false,
      coordinate: "withheld",
    },
    sidecar: {
      index: row,
      originalRecord: raw,
      sourceAssociations,
      editorialItems: [],
      retainedDetail: [
        "All original fields, claim references, unrecognized tags, photo candidates, community and workflow metadata remain in originalRecord; the public schema is not expanded.",
      ],
    },
  };
  const identity = object(raw.identity),
    content = object(raw.content),
    geography = object(raw.geography),
    access = object(raw.access);
  const scope = resolver.forRecord(row, raw),
    sources: Source[] = [],
    seenSources = new Set<string>(),
    associated = new Set<string>();
  const addSource = (
    entry: SourceEntry,
    kind: SourceAssociation["kind"],
    field: string,
  ) => {
    let url = "";
    try {
      url = safeUrl(entry.url, "source URL", false, true, true);
    } catch {
      warn(
        "invalid-source-url",
        field,
        `Invalid source URL retained only in provenance (${entry.sourceId}).`,
      );
      return;
    }
    const associationKey = `${field}|${entry.namespace}|${entry.sourceId}|${kind}|${url}`;
    if (!associated.has(associationKey)) {
      associated.add(associationKey);
      sourceAssociations.push({
        field,
        namespace: entry.namespace,
        sourceId: entry.sourceId || null,
        url,
        kind,
        original: entry.raw,
      });
    }
    if (kind === "media" || kind === "geography" || kind === "unmapped") return;
    const key = `${kind}:${url}`;
    if (seenSources.has(key)) return;
    const title =
      first(entry.raw.title, entry.raw.name) ||
      `${new URL(url).hostname} — ${kind === "reports" ? "attributed account" : kind}`;
    if (title.length > 250) {
      warn(
        "source-title-overflow",
        field,
        `Source title exceeds 250 characters (${entry.sourceId}); retained in sidecar.`,
      );
      return;
    }
    seenSources.add(key);
    sources.push({ title, url, kind });
  };
  const addId = (
    id: string,
    kind: SourceAssociation["kind"],
    field: string,
  ) => {
    const found = scope.lookup(id);
    if (!found) {
      warn(
        "unresolved-source-id",
        field,
        `Source ID is missing or ambiguous in ${scope.namespace}: ${id}`,
      );
      return;
    }
    const kinds = roleKinds(found.raw);
    if (kind === "reports" && kinds.length === 1 && kinds[0] === "media") {
      warn(
        "source-role-conflict",
        field,
        `Claim references a media-only source (${id}); retained for review.`,
      );
      addSource(found, kinds[0], field);
    } else addSource(found, kind, field);
  };
  const refs = (
    value: unknown,
    kind: SourceAssociation["kind"],
    field: string,
  ) => {
    if (Array.isArray(value)) {
      value.forEach((block, i) => refs(block, kind, `${field}/${i}`));
      return;
    }
    const block = object(value);
    for (const id of unique([
      ...strings(block.source_ids),
      ...strings(block.source_id),
      ...strings(block.basis_source_ids),
      ...strings(block.basis_source_id),
    ]))
      addId(id, kind, field);
    for (const url of unique([
      ...strings(block.source_urls),
      ...strings(block.source_url),
    ])) {
      const existing = scope.embedded.find((entry) => entry.url === url);
      addSource(
        existing || {
          namespace: scope.namespace,
          sourceId: "",
          raw: { url },
          url,
        },
        kind,
        field,
      );
    }
  };
  refs(content.history, "history", "content/history");
  refs(content.historical_context, "history", "content/historical_context");
  for (const key of [
    "hauntings",
    "haunting_description",
    "haunting_accounts",
    "haunting",
  ])
    refs(content[key], "reports", `content/${key}`);
  refs(content.visiting, "visiting", "content/visiting");
  refs(access, "visiting", "access");
  // Visitor links establish their own purpose; they are not automatically an
  // official homepage or a haunting source. Preserve singular and plural forms.
  for (const field of [
    "visitor_information_url",
    "visitor_information_urls",
    "booking_url",
    "booking_urls",
    "public_visitor_contact_url",
    "official_website",
  ])
    refs(
      { source_urls: strings(access[field]) },
      "visiting",
      `access/${field}`,
    );
  for (const field of [
    "access_source_url",
    "access_source_urls",
    "access_source",
    "access_sources",
  ]) {
    const values = Array.isArray(raw[field])
      ? (raw[field] as unknown[])
      : [raw[field]];
    for (const value of values) {
      if (typeof value === "string" && /^https?:\/\//.test(value))
        refs({ source_url: value }, "visiting", field);
      else if (value && typeof value === "object")
        refs(
          {
            ...object(value),
            source_url: first(object(value).source_url, object(value).url),
          },
          "visiting",
          field,
        );
      // Free-form prose (for example 'inherited; see sources') is not a URL or
      // resolvable source ID. It remains unchanged in the raw sidecar.
      else if (typeof value === "string" && scope.lookup(value))
        addId(value, "visiting", field);
    }
  }
  refs(geography, "geography", "geography");
  refs(geography.coordinates, "geography", "geography/coordinates");
  refs(raw.physical_status, "visiting", "physical_status");
  // Summaries and introductions can mix historical context with folklore.
  // Reuse each cited source's established role instead of relabeling every
  // historical/visitor citation as paranormal evidence.
  for (const key of ["introduction", "card_summary"]) {
    const block = object(content[key]);
    for (const id of strings(block.source_ids)) {
      const source = scope.lookup(id);
      if (!source) {
        warn(
          "unresolved-source-id",
          `content/${key}`,
          `Unresolved summary source in ${scope.namespace}: ${id}`,
        );
        continue;
      }
      const previous = sourceAssociations
        .filter(
          (entry) =>
            entry.sourceId === id && entry.namespace === source.namespace,
        )
        .map((entry) => entry.kind);
      for (const kind of unique(
        previous.length ? previous : roleKinds(source.raw),
      ))
        addSource(source, kind, `content/${key}`);
    }
  }
  // Flat adapters have no claim-level blocks. Respect each explicit source role,
  // never turn every bibliography URL (especially photo pages) into a report.
  const bibliography = [...scope.embedded];
  for (const id of unique([
    ...strings(raw.source_ids),
    ...strings(content.source_ids),
  ])) {
    const entry = scope.lookup(id);
    if (entry) bibliography.push(entry);
    else
      warn(
        "unresolved-source-id",
        "source_ids",
        `Source ID is missing or ambiguous in ${scope.namespace}: ${id}`,
      );
  }
  for (const entry of bibliography)
    for (const kind of roleKinds(entry.raw))
      addSource(entry, kind, "bibliography");
  const narrativeCaveats = unique([
    ...strings(raw.research_notes),
    ...strings(raw.notes),
    ...strings(object(raw.workflow).notes),
  ])
    .filter((note) =>
      /legend|folklore|allegation|witness|identity|historical|corroborat|claim|tradition|reputation/i.test(
        note,
      ),
    )
    .filter(
      (note) =>
        !/PHASM|dataset|baseline|package|image|photo|website|deploy|import|source.{0,8}checked|profile.{0,12}(preserv|existing)/i.test(
          note,
        ),
    );
  const reports = joinText(
    content.introduction,
    content.hauntings,
    content.haunting_accounts,
    content.haunting,
    content.haunting_description,
    raw.haunting_description,
    raw.story,
    raw.description,
    ...narrativeCaveats,
  );
  if (narrativeCaveats.length)
    fieldDecisions.push({
      field: "reports",
      action: "retain-editorial-caveats",
      basis:
        "Supplied narrative qualifications are retained verbatim; operational/media notes remain in the sidecar.",
      candidate: narrativeCaveats,
    });
  const history = joinText(
    content.history,
    content.historical_context,
    raw.history,
  );
  let summary =
    joinText(content.card_summary, raw.card_summary, raw.summary) || reports;
  if (summary.length > 1000) {
    const sentence = summary.match(/^.{1,999}?[.!?](?=\s|$)/su)?.[0];
    summary =
      sentence ||
      `${first(identity.name, raw.name, row.name)} — attributed haunting research in ${string(row.state)}.`;
    warn(
      "summary-excerpt",
      "summary",
      "The full supplied text exceeds the card limit. A complete opening sentence or factual location label is used on cards; the complete original remains in reports and/or the sidecar.",
    );
  }
  const accessLabel = first(
    access.status,
    access.category,
    raw.access_status,
    typeof raw.access === "string" ? raw.access : "",
  );
  const accessValue = accessOf(accessLabel);
  if (accessValue === "unknown")
    warn(
      "access-unconfirmed",
      "access",
      "Current visiting permission is unconfirmed; retained as unknown.",
    );
  const physical = object(raw.physical_status);
  const physicalStatus = first(
    physical.status,
    typeof raw.physical_status === "string" ? raw.physical_status : "",
  );
  const accessNotes =
    joinText(
      content.visiting,
      access.notes,
      access.note,
      access.caution,
      access.practical_caution,
      access.restrictions,
      raw.access_notes,
      raw.access_note,
      raw.access_caution,
      /closed|demolish|relocat/.test(normalized(accessLabel))
        ? `Research access status: ${accessLabel.replace(/_/g, " ")}.`
        : "",
      /closed|demolish|relocat|former venue/.test(normalized(physicalStatus))
        ? `Research physical status: ${physicalStatus.replace(/_/g, " ")}.`
        : "",
      physical.notes,
      /unknown|unverified|not.currently/.test(normalized(accessLabel))
        ? "Current access is unconfirmed."
        : "",
    ) ||
    "Current visiting conditions are unverified. A haunting account is not permission to enter; follow the owner’s rules and posted restrictions.";
  let officialUrl = first(
    access.official_website,
    raw.official_website,
    raw.officialUrl,
  );
  if (officialUrl)
    try {
      officialUrl = safeUrl(officialUrl, "official URL", false, false, true);
    } catch {
      warn(
        "invalid-official-url",
        "officialUrl",
        "Invalid official URL retained in the sidecar.",
      );
      officialUrl = "";
    }
  const rawCategory = first(
    identity.primary_category,
    identity.category,
    identity.place_type,
    raw.category,
    raw.place_type,
  );
  const category = categoryOf(rawCategory);
  fieldDecisions.push({
    field: "category",
    action: "mapped",
    basis: rawCategory || "Unspecified research category",
    candidate: category,
  });
  const rawClassification = first(
    identity.paranormal_tradition_classification,
    identity.prominence,
    raw.classification,
    content.classification,
  );
  const classification: Location["classification"] =
    /community.reported haunting|community.discovery/.test(
      normalized(rawClassification),
    )
      ? "community-discovery"
      : "local-legend";
  fieldDecisions.push({
    field: "classification",
    action: "mapped",
    basis:
      "Attributed research defaults to local legend; an established venue or research readiness flag does not establish supernatural claims.",
    candidate: rawClassification,
  });
  const tours: Location["tours"] =
    /^(tour|public_tour|guided tour only)$/i.test(accessLabel)
      ? "yes"
      : "unknown";
  const point = object(geography.coordinates ?? raw.coordinates);
  const latitude = point.latitude ?? point.lat,
    longitude = point.longitude ?? point.lng ?? point.lon;
  let coordinates: Pick<
    Location,
    "latitude" | "longitude" | "coordinatePrecision"
  > = { latitude: null, longitude: null, coordinatePrecision: "withheld" };
  const precision = first(
    point.precision,
    geography.precision,
    raw.coordinate_precision,
    raw.map_precision,
  );
  const pointKind = first(point.point_kind, geography.point_kind, precision);
  const visibility = first(
    geography.mapping_visibility,
    raw.mapping_visibility,
  );
  const coordinateSources: string[] = [];
  const sourceCandidates = [
    point.source_url,
    ...strings(point.source_urls),
    geography.source_url,
    ...strings(geography.source_urls),
    geography.coordinate_source_url,
    ...strings(geography.coordinate_source_urls),
    raw.coordinate_source_url,
    ...strings(raw.coordinate_source_urls),
    ...(Array.isArray(geography.coordinate_source)
      ? geography.coordinate_source
      : [geography.coordinate_source]),
    ...(Array.isArray(raw.coordinate_source)
      ? raw.coordinate_source
      : [raw.coordinate_source]),
    ...array(raw.coordinate_provenance),
  ];
  for (const candidate of sourceCandidates) {
    const url =
      typeof candidate === "object"
        ? first(object(candidate).url, object(candidate).source_url)
        : string(candidate);
    if (/^https?:\/\//.test(url))
      try {
        coordinateSources.push(
          safeUrl(url, "coordinate source", false, true, true),
        );
      } catch {
        warn(
          "invalid-coordinate-source-url",
          "coordinates",
          "Invalid coordinate source URL retained only in the sidecar.",
        );
      }
  }
  for (const id of unique([
    ...strings(point.source_ids),
    ...strings(geography.source_ids),
    ...strings(raw.coordinate_source).filter((entry) => !entry.includes("://")),
  ])) {
    const entry = scope.lookup(id);
    if (entry) {
      try {
        coordinateSources.push(
          safeUrl(entry.url, "coordinate source", false, true, true),
        );
        addSource(entry, "geography", "coordinates");
      } catch {
        /* An invalid URL was reported by the source adapter. */
      }
    }
  }
  if (typeof latitude === "number" && typeof longitude === "number") {
    const validBounds =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180 &&
      !(latitude === 0 && longitude === 0);
    const privateResidence =
      accessValue === "private" ||
      /occupied.*residen|private.residen|private.house/.test(
        normalized(
          [accessLabel, rawCategory, first(geography.address_publication)].join(
            " ",
          ),
        ),
      );
    const withheld = /withheld|unverified|pending|camera|photo viewpoint/.test(
      normalized([visibility, pointKind].join(" ")),
    );
    const centroidMeaning = normalized([pointKind, precision].join(" "));
    const administrativeCentroid =
      /\b(city|town|municipal(?:ity)?|regional?|state|county|postal|zip)\b.{0,40}\b(center|centre|centroid)\b|\b(center|centre|centroid)\b.{0,40}\b(city|town|municipal(?:ity)?|regional?|state|county|postal|zip)\b/.test(
        centroidMeaning,
      );
    if (
      validBounds &&
      coordinateSources.length &&
      pointKind &&
      !privateResidence &&
      !withheld &&
      !administrativeCentroid
    ) {
      coordinates = { latitude, longitude, coordinatePrecision: "approximate" };
      plan.readiness.coordinate = "approximate";
      fieldDecisions.push({
        field: "coordinates",
        action: "accepted-approximate",
        basis: `${pointKind}; cited research reference, not a surveyed entrance.`,
        candidate: {
          latitude,
          longitude,
          sourceUrls: unique(coordinateSources),
        },
      });
    } else {
      warn(
        "coordinates-deferred",
        "coordinates",
        !validBounds
          ? "Numeric pair is invalid or a zero placeholder."
          : privateResidence
            ? "Private/occupied residential point remains withheld."
            : administrativeCentroid
              ? "A city/town/administrative centroid is not a site reference; only coordinates are deferred."
              : withheld
                ? "Research explicitly withholds the point or describes an unverified/photo viewpoint."
                : "Numeric pair lacks a resolvable source or point meaning; only coordinates are deferred.",
      );
    }
  } else if (latitude != null || longitude != null)
    warn(
      "coordinates-deferred",
      "coordinates",
      "Incomplete or nonnumeric coordinate pair retained only in provenance.",
    );
  const city = first(identity.locality, identity.city, raw.city, row.city);
  if (!city)
    warn(
      "missing-locality",
      "city",
      "No locality was supplied; the city remains empty, with no guessed locality or pin.",
    );
  const location: Location = {
    id: appId,
    slug: appId.replace(/^phasm-us-/, "").replace(/-+/g, "-"),
    name: first(identity.name, raw.name, row.name),
    city,
    state: string(row.state),
    country: "United States",
    region: "North America",
    ...coordinates,
    category,
    classification,
    summary,
    history,
    reports,
    phenomena: phenomenaOf(raw.phenomenon_tags, warn),
    access: accessValue,
    tours,
    accessNotes,
    officialUrl,
    sources,
    image: PLACEHOLDER,
    imageAlt: `Nonphotographic illustration; a verified photograph of ${first(identity.name, raw.name, row.name)} is not available.`,
    imageCredit: "PHASM — original nonphotographic atlas illustration.",
    imageLicense: "PHASM original illustration",
    imageSource: PLACEHOLDER,
    status: "draft",
    featured: false,
    updatedAt,
  };
  fieldDecisions.push({
    field: "media",
    action: "placeholder",
    basis:
      "Historical package photo statuses are evidence only. A separately validated exact-file photo patch must clear an asset before installation.",
  });
  fieldDecisions.push({
    field: "status",
    action: "draft",
    basis: "Research integration does not authorize publication.",
  });
  if (!reports)
    warn(
      "missing-report-copy",
      "reports",
      "No supported narrative shape was found; original record retained for review.",
    );
  if (!sources.some((source) => source.kind === "reports"))
    warn(
      "missing-report-source",
      "sources",
      "No unambiguous report source was mapped; content remains reviewable as a draft.",
    );
  try {
    plan.nextLocation = validateLocation(location);
    plan.readiness.importValid = true;
    plan.readiness.contentReady = Boolean(
      reports &&
      sources.some((source) => source.kind === "reports") &&
      !warnings.some((warning) =>
        /invalid|unresolved|overflow|conflict|missing-locality/.test(
          warning.code,
        ),
      ),
    );
    plan.afterHash = hashValue(plan.nextLocation);
  } catch (error) {
    plan.disposition = "deferred";
    warn(
      "native-validation",
      "record",
      error instanceof Error ? error.message : String(error),
    );
    plan.sidecar.retainedDetail.push(
      "The complete native candidate is retained below because validation failed; no prose or bibliography was silently truncated.",
    );
    plan.fieldDecisions.push({
      field: "record",
      action: "deferred",
      basis: "Native validation failed without destructive normalization.",
      candidate: location,
    });
  }
  return plan;
}

function enrichBaseline(
  plan: NationwideRecordPlan,
  existing: Location,
  updatedAt: string,
): void {
  const candidate = plan.nextLocation;
  const next = structuredClone(existing);
  plan.beforeHash = hashValue(existing);
  plan.readiness.coordinate =
    existing.latitude === null ? "withheld" : "preserved";
  plan.readiness.imageReady = !/placeholder\.svg$/.test(existing.image);
  plan.readiness.published = existing.status === "published";
  if (candidate) {
    for (const field of [
      "name",
      "city",
      "summary",
      "history",
      "reports",
      "access",
      "accessNotes",
      "officialUrl",
    ] as const) {
      if (candidate[field] && candidate[field] !== existing[field]) {
        const canFill =
          ["history", "reports", "officialUrl"].includes(field) &&
          !existing[field];
        const kind =
          field === "history"
            ? "history"
            : field === "reports"
              ? "reports"
              : "visiting";
        const additions = candidate.sources.filter(
          (source) =>
            source.kind === kind &&
            !next.sources.some(
              (current) =>
                current.url === source.url && current.kind === source.kind,
            ),
        );
        if (
          canFill &&
          (field === "officialUrl" ||
            candidate.sources.some((source) => source.kind === kind)) &&
          next.sources.length + additions.length <= 30
        ) {
          (next as unknown as ObjectValue)[field] = candidate[field];
          next.sources.push(...additions);
          plan.fieldDecisions.push({
            field,
            action: "fill-empty",
            basis:
              "Additive enrichment of an empty field with source support; existing authored values are never replaced.",
            candidate: candidate[field],
          });
        } else {
          plan.fieldDecisions.push({
            field,
            action: "preserved-current",
            basis:
              "Existing reviewed/member content takes precedence; research replacement is available for editorial review.",
            candidate: candidate[field],
          });
          plan.warnings.push({
            code: "baseline-field-review",
            field,
            message: "Research differs; current value retained.",
          });
        }
      }
    }
  }
  if (hashValue(next) !== hashValue(existing)) next.updatedAt = updatedAt;
  // Never normalize the preserved record through a validator that could trim or
  // reorder it. Validate a copy, then retain the exact original native values.
  try {
    validateLocation(next);
  } catch (error) {
    plan.disposition = "conflicted";
    plan.nextLocation = undefined;
    plan.afterHash = null;
    plan.warnings.push({
      code: "current-record-invalid",
      field: "record",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  plan.nextLocation = next;
  plan.afterHash = hashValue(next);
  plan.disposition =
    plan.afterHash === plan.beforeHash ? "unchanged" : "updated";
  plan.readiness.importValid = true;
  plan.fieldDecisions.push({
    field: "identity/media/geography/publication",
    action: "preserved-current",
    basis:
      "Current IDs, slug, imagery, coordinates, publication, ordering and all other nonempty current fields are preserved.",
  });
}

/** Deterministic coverage selection, expressed as stable research IDs. */
export function selectNationwidePilot(
  records: NationwideRecordPlan[],
  size = 25,
): string[] {
  const picked: NationwideRecordPlan[] = [];
  const add = (record: NationwideRecordPlan | undefined) => {
    if (record && picked.length < size && !picked.includes(record))
      picked.push(record);
  };
  for (const id of [
    "phasm-us-co-stanley-hotel",
    "phasm-us-ca-queen-mary",
    "phasm-us-ca-winchester-mystery-house",
    "phasm-us-pa-eastern-state-penitentiary",
    "phasm-us-co-hiwan-homestead-museum",
    "phasm-us-co-lace-house-museum",
    "phasm-us-co-pueblo-firefighters-museum",
    "phasm-us-ar-springfield-des-arc-bridge",
    "phasm-us-ne-warbonnet-creek-battlefield-site",
    "phasm-us-ri-white-horse-tavern",
    "phasm-us-wy-st-marks-episcopal-church",
    "phasm-us-wy-virginian-hotel",
    "phasm-us-wy-cheyenne-masonic-temple",
  ])
    add(records.find((record) => record.researchId === id));
  for (const shape of [
    "story",
    "description",
    "haunting_description",
    "haunting_accounts",
    "haunting",
    "hauntings",
  ])
    add(
      records.find(
        (record) =>
          object(record.sidecar.originalRecord)[shape] ||
          object(object(record.sidecar.originalRecord).content)[shape],
      ),
    );
  for (const access of ["private", "unknown", "restricted", "public"])
    add(
      records.find(
        (record) => !record.baseline && record.nextLocation?.access === access,
      ),
    );
  add(
    records.find(
      (record) =>
        record.sidecar.index.photo_status === "publishable_verified" &&
        !record.baseline,
    ),
  );
  add(
    records.find(
      (record) =>
        record.sidecar.index.photo_status ===
          "rights_verified_visual_pending" && !record.baseline,
    ),
  );
  for (const record of records)
    if (
      !picked.some(
        (other) => other.sidecar.index.state === record.sidecar.index.state,
      )
    )
      add(record);
  for (const record of records) add(record);
  return picked.map((record) => record.researchId);
}

/**
 * Read-only planning: the caller owns snapshots, writes, resume and rollback.
 * With selectedIds, locations contains every current record plus only selected
 * additions/enrichments; all unselected indexed rows have deferred dispositions.
 * Input fingerprint hashes CHECKSUMS.sha256 and therefore does not change when
 * separately verified photographs arrive. Verify payload bytes before applying.
 */
export function buildNationwidePlan(
  inputRoot: string,
  currentCatalog: Location[],
  options: NationwideOptions = {},
): NationwidePlan {
  const input = new InputReader(inputRoot);
  const manifest = object(input.read("MANIFEST.json"));
  const rows = array(input.read("index/PROFILE_INDEX.json")).map(object);
  const crosswalk = array(input.read("index/GLOBAL_ID_CROSSWALK.json")).map(
    object,
  );
  const baselineCrosswalk = array(
    input.read("index/BASELINE_CROSSWALK.json"),
  ).map(object);
  const sources = array(input.read("index/SOURCE_INDEX.json"));
  const baselineSources = array(
    object(input.read("baseline/phasm_sources.json")).sources,
  );
  const editorial = array(input.read("index/EDITORIAL_REVIEW_ITEMS.json"));
  const duplicate = array(input.read("index/DUPLICATE_AUDIT.json"));
  const border = array(input.read("index/BORDER_SITE_AUDIT.json"));
  const resolver = new SourceResolver(sources, baselineSources);
  const date = options.updatedAt || string(manifest.research_date);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(date) ||
    !Number.isFinite(Date.parse(date))
  )
    throw new Error("A stable, valid input research date is required.");
  const crossByResearch = new Map(
    crosswalk.map((row) => [string(row.research_id), row]),
  );
  const baselineByResearch = new Map(
    baselineCrosswalk.flatMap((row) =>
      strings(row.research_record_ids).map((id) => [id, row] as const),
    ),
  );
  if (
    crossByResearch.size !== crosswalk.length ||
    rows.length !== new Set(rows.map((row) => row.research_id)).size
  )
    throw new Error("Duplicate research IDs in counting authority/crosswalk.");
  const currentIds = new Map(currentCatalog.map((row) => [row.id, row]));
  const occupiedSlugs = new Map(
    currentCatalog.map((row) => [row.slug, row.id]),
  );
  const occupiedIdentities = new Map(
    currentCatalog.map((row) => [identityKey(row), row.id]),
  );
  if (
    currentIds.size !== currentCatalog.length ||
    occupiedSlugs.size !== currentCatalog.length ||
    occupiedIdentities.size !== currentCatalog.length
  )
    throw new Error(
      "Current catalog contains duplicate identities; reconcile before import.",
    );
  const selected = options.selectedIds ? new Set(options.selectedIds) : null;
  if (
    selected &&
    [...selected].some((id) => !rows.some((row) => row.research_id === id))
  )
    throw new Error("Selection contains an unknown research ID.");
  const records: NationwideRecordPlan[] = [],
    nextById = new Map(
      currentCatalog.map((row) => [row.id, structuredClone(row)]),
    );
  const seenCanonical = new Set<string>();
  for (const row of rows) {
    const researchId = string(row.research_id),
      canonical = crossByResearch.get(researchId);
    const appId = first(row.preserve_app_id, row.canonical_site_id);
    let plan: NationwideRecordPlan;
    try {
      if (
        !canonical ||
        canonical.canonical_site_id !== appId ||
        canonical.preserve_app_id !== row.preserve_app_id ||
        canonical.source_file !== row.source_file ||
        canonical.record_pointer !== row.record_pointer
      )
        throw new Error(
          "Counting authority and global identity crosswalk disagree.",
        );
      if (seenCanonical.has(appId))
        throw new Error("Repeated canonical app ID requires duplicate review.");
      seenCanonical.add(appId);
      if (
        row.baseline_match === true &&
        baselineByResearch.get(researchId)?.preserve_app_id !== appId
      )
        throw new Error(
          "Baseline crosswalk does not establish the preserved app ID.",
        );
      const raw = object(
        resolveJsonPointer(
          input.read(string(row.source_file)),
          string(row.record_pointer),
        ),
      );
      if (!Object.keys(raw).length)
        throw new Error("Profile pointer did not resolve to a record object.");
      plan = adaptRecord(row, raw, resolver, date);
      plan.sidecar.editorialItems = editorial.filter(
        (entry) => object(entry).research_id === researchId,
      );
      if (plan.sidecar.editorialItems.length)
        plan.warnings.push({
          code: "editorial-exception",
          field: "identity",
          message:
            "Package locality/image-subject candidate requires editorial review. No photo caption was adopted as a location correction.",
        });
      if (
        /phasm-us-wy-(st-marks-episcopal-church|virginian-hotel|cheyenne-masonic-temple)$/.test(
          researchId,
        )
      )
        plan.warnings.push({
          code: "quarantined-photo-choice",
          field: "media",
          message:
            "Known Wyoming source/image-rights mismatch; location retained and candidate image quarantined pending an exact-file patch.",
        });
      const existing = currentIds.get(appId);
      if (plan.baseline) {
        if (existing) enrichBaseline(plan, existing, date);
        else {
          plan.disposition = "conflicted";
          plan.nextLocation = undefined;
          plan.afterHash = null;
          plan.warnings.push({
            code: "missing-current-baseline",
            field: "id",
            message:
              "Preserved baseline identity is absent from the current catalog; historical snapshots are not authority to restore it automatically.",
          });
        }
      } else if (existing) {
        plan.beforeHash = hashValue(existing);
        if (
          plan.nextLocation &&
          hashValue(plan.nextLocation) === plan.beforeHash
        ) {
          plan.disposition = "unchanged";
          plan.nextLocation = structuredClone(existing);
        } else {
          plan.disposition = "conflicted";
          plan.nextLocation = undefined;
          plan.afterHash = null;
          plan.warnings.push({
            code: "existing-id-conflict",
            field: "id",
            message:
              "The proposed ID already exists with different data. Current/member changes are preserved; no replacement is automatic.",
          });
        }
      }
      if (plan.nextLocation && !existing) {
        const slugConflict = occupiedSlugs.get(plan.nextLocation.slug),
          identityConflict = occupiedIdentities.get(
            identityKey(plan.nextLocation),
          );
        if (slugConflict || identityConflict) {
          plan.disposition = "conflicted";
          plan.nextLocation = undefined;
          plan.afterHash = null;
          plan.warnings.push({
            code: "current-catalog-overlap",
            field: "identity",
            message: `Current or earlier input record overlaps by slug or full name/locality/state/country: ${slugConflict || identityConflict}. No automatic merge or duplicate padding.`,
          });
        }
      }
      if (selected && !selected.has(researchId)) {
        plan.disposition = "deferred";
        plan.nextLocation = undefined;
        plan.afterHash = null;
        plan.warnings.push({
          code: "outside-selection",
          field: "record",
          message:
            "Not selected for this deterministic pilot/batch; current data remains untouched.",
        });
      }
    } catch (error) {
      plan = {
        researchId,
        appId,
        sourceFile: string(row.source_file),
        recordPointer: string(row.record_pointer),
        baseline: row.baseline_match === true,
        disposition: "rejected",
        beforeHash: currentIds.has(appId)
          ? hashValue(currentIds.get(appId))
          : null,
        afterHash: null,
        warnings: [
          {
            code: "input-identity-or-pointer",
            field: "record",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        fieldDecisions: [],
        readiness: {
          importValid: false,
          contentReady: false,
          imageReady: false,
          published: false,
          coordinate: "withheld",
        },
        sidecar: {
          index: row,
          originalRecord: null,
          sourceAssociations: [],
          editorialItems: [],
          retainedDetail: [
            "Immutable source artifact and index pointer retained; failed identity/pointer was not applied.",
          ],
        },
      };
    }
    if (
      plan.nextLocation &&
      ["created", "updated", "unchanged"].includes(plan.disposition)
    ) {
      nextById.set(appId, plan.nextLocation);
      occupiedSlugs.set(plan.nextLocation.slug, appId);
      occupiedIdentities.set(identityKey(plan.nextLocation), appId);
    }
    records.push(plan);
  }
  const locations = [...nextById.values()];
  const inputFiles = [...input.files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, sha256]) => ({ path, sha256 }));
  const summary: Record<string, number> = {
    input: rows.length,
    baseline: records.filter((record) => record.baseline).length,
    current: currentCatalog.length,
    output: locations.length,
    outsidePackage: currentCatalog.filter(
      (record) => !seenCanonical.has(record.id),
    ).length,
    contentReady: records.filter((record) => record.readiness.contentReady)
      .length,
    imageReady: records.filter((record) => record.readiness.imageReady).length,
    existingMediaRetained: records.filter(
      (record) => record.baseline && currentIds.has(record.appId),
    ).length,
    independentlyClearedNewImages: 0,
    importValid: records.filter((record) => record.readiness.importValid)
      .length,
    numericResearchPairs: rows.filter(
      (row) => row.coordinates_present_in_research === true,
    ).length,
    numericResearchBaseline: rows.filter(
      (row) =>
        row.baseline_match === true &&
        row.coordinates_present_in_research === true,
    ).length,
    numericResearchAdditions: rows.filter(
      (row) =>
        row.baseline_match !== true &&
        row.coordinates_present_in_research === true,
    ).length,
    preservedPins: records.filter(
      (record) => record.readiness.coordinate === "preserved",
    ).length,
    newApproximatePins: records.filter(
      (record) =>
        !record.baseline &&
        record.nextLocation?.coordinatePrecision === "approximate",
    ).length,
    coordinatesWithheld: records.filter(
      (record) => record.nextLocation?.coordinatePrecision === "withheld",
    ).length,
    published: locations.filter((record) => record.status === "published")
      .length,
    drafts: locations.filter((record) => record.status === "draft").length,
  };
  for (const disposition of [
    "created",
    "updated",
    "unchanged",
    "conflicted",
    "rejected",
    "deferred",
  ] as const)
    summary[disposition] = records.filter(
      (record) => record.disposition === disposition,
    ).length;
  return {
    version: NATIONWIDE_ADAPTER_VERSION,
    inputFingerprint: input.checksumFingerprint(),
    inputFiles,
    records,
    locations,
    pilotIds: selectNationwidePilot(records),
    summary,
    audits: { duplicate, border, editorial },
  };
}
