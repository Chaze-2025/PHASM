import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Location, Source } from "../shared/types";
import { validateImport } from "./import-locations";

interface Block {
  text: string;
  source_ids: string[];
}
export interface ResearchLocation {
  research_id: string;
  existing_phasm_id: string | null;
  identity: {
    name: string;
    locality: string;
    state: string;
    state_code: string;
    country: string;
    continent: string;
    primary_category: string;
    prominence: string;
    paranormal_tradition_classification?: string;
  };
  geography: {
    coordinates: { latitude: number; longitude: number } | null;
    precision: string | null;
    mapping_visibility: string;
  };
  content: {
    card_summary: Block;
    introduction: Block | null;
    history: Block[];
    hauntings: Block[];
    visiting: Block;
  };
  phenomenon_tags: string[];
  access: { status: string; official_website: string | null };
  source_ids: string[];
  community: { reviews: unknown[]; ratings: unknown };
  last_reviewed_on: string;
}
export interface ResearchSource {
  source_id: string;
  title: string;
  url: string;
  organization: string | null;
  author?: string | null;
  publication_date?: string | null;
  accessed_on?: string;
  source_type?: string;
}
interface Review {
  access: Location["access"];
  tours: Location["tours"];
}
interface CopyAdjustment {
  sourceSha256: string;
  text: string;
}
export interface ImportOptions {
  reviews: Record<string, Review>;
  copyAdjustments: Record<string, CopyAdjustment>;
}

const categories: Record<string, string> = {
  "Cemetery & graveyard": "Cemetery",
  "Haunted house": "Historic house",
  "Historic house & estate": "Historic house",
  "Hotel & inn": "Hotel",
  "Hospital & institution": "Hospital",
  Prison: "Prison",
  Theater: "Theater",
  "Road, bridge & tunnel": "Road or bridge",
  "Natural landmark": "Natural landmark",
  "Park & outdoor site": "Natural landmark",
  Cave: "Natural landmark",
  "Cave & tunnel": "Natural landmark",
  "Ghost town": "Ghost town",
  "Military site": "Other",
  "Historic business": "Other",
  Library: "Other",
  Lighthouse: "Other",
  "Historic ship": "Other",
  "Arts venue": "Other",
  "Historic civic building": "Other",
  "Historic building": "Other",
  "Historic industrial site": "Other",
  "Church & historic building": "Other",
  "School & historic building": "Other",
  "Museum & historic building": "Other",
};

const classifications: Record<string, Location["classification"]> = {
  "Established Haunting": "established",
  "Established destination": "established",
  "Local Legend": "local-legend",
  "Local lore": "local-legend",
  "Community-Reported Haunting": "community-discovery",
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Convert only explicitly public prose. Full research and internal notes stay external. */
export function convertResearch(
  research: ResearchLocation[],
  sourceRegister: ResearchSource[],
  baseline: Location[],
  options: ImportOptions,
) {
  const sourceMap = new Map(
    sourceRegister.map((source) => [source.source_id, source]),
  );
  if (sourceMap.size !== sourceRegister.length)
    throw new Error("Duplicate research source IDs.");
  const baselineMap = new Map(
    baseline.map((location) => [location.id, location]),
  );
  const converted = new Map<string, Location>();
  const provenance: object[] = [];
  const usedAdjustments = new Set<string>();

  for (const record of research) {
    const review = options.reviews[record.research_id];
    if (!review)
      throw new Error(`Missing reviewed access mapping: ${record.research_id}`);
    const id = record.existing_phasm_id || record.research_id;
    const existing = baselineMap.get(id);
    if (record.existing_phasm_id && !existing)
      throw new Error(`Existing app ID missing from baseline: ${id}`);
    if (converted.has(id))
      throw new Error(`Duplicate research identity: ${id}`);
    if (record.community.reviews.length || record.community.ratings !== null)
      throw new Error(`Research must not supply member activity: ${id}`);
    const publicText = (path: string, block: Block | null): string => {
      if (!block) return "";
      const key = `${record.research_id}/${path}`;
      const adjustment = options.copyAdjustments[key];
      if (!adjustment) return block.text;
      if (sha256(block.text) !== adjustment.sourceSha256)
        throw new Error(`Reviewed copy has changed: ${key}`);
      usedAdjustments.add(key);
      return adjustment.text;
    };

    const sourceRoles: { sourceId: string; kind: Source["kind"] }[] = [];
    const sources: Source[] = [];
    const seenSourceUrls = new Set<string>();
    const roles: [Source["kind"], Block[]][] = [
      ["history", record.content.history],
      ["reports", record.content.hauntings],
      ["visiting", [record.content.visiting]],
    ];
    for (const [kind, blocks] of roles) {
      for (const sourceId of new Set(
        blocks.flatMap((block) => block.source_ids),
      )) {
        const source = sourceMap.get(sourceId);
        if (!source) throw new Error(`Missing source ${sourceId} for ${id}`);
        sourceRoles.push({ sourceId, kind });
        const sourceKey = `${kind}:${new URL(source.url).href}`;
        if (seenSourceUrls.has(sourceKey)) continue;
        seenSourceUrls.add(sourceKey);
        const title =
          source.organization && !source.title.includes(source.organization)
            ? `${source.organization} — ${source.title}`
            : source.title;
        sources.push({ title, url: source.url, kind });
      }
    }
    // Introduction references must already resolve to their actual supported role;
    // never reclassify a historical citation as a paranormal-report source.
    for (const sourceId of [
      ...(record.content.introduction?.source_ids ?? []),
      ...record.content.card_summary.source_ids,
    ]) {
      if (!sourceRoles.some((source) => source.sourceId === sourceId))
        throw new Error(
          `Unmapped summary/introduction source: ${id}: ${sourceId}`,
        );
    }
    for (const sourceId of record.source_ids) {
      if (!sourceMap.has(sourceId))
        throw new Error(`Unresolved source: ${sourceId}`);
    }

    const coordinates =
      record.geography.mapping_visibility === "public"
        ? record.geography.coordinates
        : null;
    if (record.geography.mapping_visibility === "public" && !coordinates)
      throw new Error(`Public research pin has no coordinates: ${id}`);
    const category = categories[record.identity.primary_category];
    const classification =
      classifications[
        record.identity.paranormal_tradition_classification ||
          record.identity.prominence
      ];
    if (!category || !classification)
      throw new Error(`Unmapped category/classification: ${id}`);
    const placeholder = "/images/location-placeholder.svg";
    const location: Location = {
      id,
      slug: existing?.slug || record.research_id.replace(/^phasm-us-/, ""),
      name: record.identity.name,
      city: record.identity.locality,
      state: record.identity.state,
      country: record.identity.country,
      region: record.identity.continent,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      coordinatePrecision: coordinates ? "approximate" : "withheld",
      category,
      classification,
      summary: publicText("card_summary", record.content.card_summary),
      history: record.content.history
        .map((block, index) => publicText(`history/${index}`, block))
        .join("\n\n"),
      reports: [
        publicText("introduction", record.content.introduction),
        ...record.content.hauntings.map((block, index) =>
          publicText(`hauntings/${index}`, block),
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      phenomena: [
        ...new Set(
          record.phenomenon_tags.map(
            (tag) => tag.charAt(0).toUpperCase() + tag.slice(1),
          ),
        ),
      ],
      access: review.access,
      tours: review.tours,
      accessNotes: publicText("visiting", record.content.visiting),
      officialUrl: record.access.official_website || "",
      sources,
      image: existing?.image || placeholder,
      imageAlt:
        existing?.imageAlt ||
        `Nonphotographic placeholder for ${record.identity.name}; location photograph pending.`,
      imageCredit:
        existing?.imageCredit ||
        "PHASM — original atlas illustration; not a location photograph.",
      imageLicense: existing?.imageLicense || "PHASM original illustration",
      imageSource: existing?.imageSource || placeholder,
      status: existing?.status || "published",
      featured: existing?.featured || false,
      updatedAt: record.last_reviewed_on,
    };
    converted.set(id, location);
    provenance.push({
      researchId: record.research_id,
      appId: id,
      slug: location.slug,
      operation: existing ? "update" : "add",
      physicalCategory: record.identity.primary_category,
      accessDescription: record.access.status,
      sourceIds: record.source_ids,
      sourceRoles,
      lastReviewedOn: record.last_reviewed_on,
    });
  }
  for (const key of Object.keys(options.copyAdjustments)) {
    if (!usedAdjustments.has(key))
      throw new Error(`Unused public-copy adjustment: ${key}`);
  }
  const baselineIds = new Set(baseline.map((record) => record.id));
  const locations = validateImport([
    ...baseline.map((record) => converted.get(record.id) || record),
    ...[...converted.values()].filter((record) => !baselineIds.has(record.id)),
  ]);
  return { locations, provenance };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [researchDirectory, ...flags] = process.argv.slice(2);
    if (!researchDirectory || flags.some((flag) => flag !== "--write"))
      throw new Error(
        "Usage: npx tsx scripts/research-import.ts /path/to/extracted-handoff [--write]",
      );
    const root = resolve(import.meta.dirname, "..");
    const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
    const researchPath = resolve(researchDirectory, "phasm_usa_locations.json");
    const sourcesPath = resolve(researchDirectory, "phasm_sources.json");
    const research = readJson(researchPath).locations as ResearchLocation[];
    const sources = readJson(sourcesPath).sources as ResearchSource[];
    if (research.length !== 130 || sources.length !== 431)
      throw new Error(
        "This reviewed conversion expects the 130-location / 431-source checkpoint.",
      );
    const baseline = readJson(
      resolve(root, "content/research/catalog-before-usa-130.json"),
    );
    const options: ImportOptions = {
      reviews: readJson(resolve(root, "content/research/usa-130-access.json")),
      copyAdjustments: readJson(
        resolve(root, "content/research/usa-130-public-copy.json"),
      ),
    };
    const result = convertResearch(research, sources, baseline, options);
    if (result.locations.length !== 136)
      throw new Error("Expected 136 reconciled locations.");
    const provenance = {
      researchCheckpoint: "2026-10-10",
      inputSha256: {
        "phasm_usa_locations.json": sha256(readFileSync(researchPath, "utf8")),
        "phasm_sources.json": sha256(readFileSync(sourcesPath, "utf8")),
      },
      baselineCount: baseline.length,
      researchCount: research.length,
      addedCount: 126,
      updatedCount: 4,
      preservedOtherCount: 6,
      catalogCount: result.locations.length,
      locations: result.provenance,
    };
    if (flags.includes("--write")) {
      writeFileSync(
        resolve(root, "content/locations.json"),
        JSON.stringify(result.locations, null, 2) + "\n",
      );
      writeFileSync(
        resolve(root, "content/research/usa-130-provenance.json"),
        JSON.stringify(provenance, null, 2) + "\n",
      );
      // Bibliographic metadata is public; inspection notes, rights candidates,
      // private editorial decisions and geographic queues stay in the handoff.
      writeFileSync(
        resolve(root, "content/research/usa-130-sources.json"),
        JSON.stringify(
          sources.map((source) => ({
            sourceId: source.source_id,
            title: source.title,
            url: source.url,
            publisher: source.organization,
            author: source.author ?? null,
            publicationDate: source.publication_date ?? null,
            accessedOn: source.accessed_on ?? null,
            sourceType: source.source_type ?? null,
          })),
          null,
          2,
        ) + "\n",
      );
    }
    console.log(
      `Validated ${result.locations.length} catalog records: 126 additions, 4 updates, 6 preserved; ${result.locations.filter((location) => location.coordinatePrecision === "withheld").length} withheld pins.${flags.includes("--write") ? " Catalog and public provenance written." : " No files changed."}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
