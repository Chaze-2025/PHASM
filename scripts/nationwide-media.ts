/** Photo review is deliberately separate from content adaptation. Nothing in this module writes files. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Location } from "../shared/types";
import { validateLocation } from "../worker/validation";

export const MEDIA_IMPORTER_VERSION = "phasm-media-v1";
export const PHOTO_FIELDS = [
  "image",
  "imageAlt",
  "imageCredit",
  "imageLicense",
  "imageSource",
] as const;
export type PhotoFields = Pick<Location, (typeof PHOTO_FIELDS)[number]>;
export const QUARANTINED_RESEARCH_IDS = new Set([
  "phasm-us-wy-st-marks-episcopal-church",
  "phasm-us-wy-virginian-hotel",
  "phasm-us-wy-cheyenne-masonic-temple",
]);
export interface MediaReview {
  researchId: string;
  assetPath: string;
  sha256: string;
  sourcePage: string;
  originalAssetUrl: string;
  originalAssetSha256: string;
  sourceEvidenceSha256: string;
  creator: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  reviewedAt: string;
  reviewer: string;
  subjectDescription: string;
  exactFileEvidence: string;
  rightsEvidence: string;
  transformations: string;
  shareAlike: string;
  exactFileVerified: boolean;
  visualSubjectVerified: boolean;
  rightsVerified: boolean;
  correctedQuarantinedChoice?: boolean;
  replaceExisting?: boolean;
}
export interface PhotoPatchManifest {
  patchVersion: string;
  reviews: MediaReview[];
}
export interface PhotoCrosswalk {
  research_id: string;
  canonical_site_id: string;
  preserve_app_id?: string | null;
}
export interface PhotoPatch {
  appId: string;
  researchId: string;
  beforeImageHash: string;
  afterImageHash: string;
  fields: PhotoFields;
}
export interface MediaPlanRecord {
  researchId: string;
  appId: string | null;
  disposition: "updated" | "unchanged" | "deferred" | "conflicted" | "rejected";
  reasons: string[];
  review?: MediaReview;
  patch?: PhotoPatch;
  nextLocation?: Location;
}
export interface MediaPlan {
  importerVersion: string;
  patchVersion: string;
  manifestHash: string;
  planHash: string;
  records: MediaPlanRecord[];
  assetCopies: {
    source: string;
    destination: string;
    sha256: string;
    researchId: string;
  }[];
  summary: Record<MediaPlanRecord["disposition"], number>;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function mediaHash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
export function imageFields(location: Location): PhotoFields {
  return Object.fromEntries(
    PHOTO_FIELDS.map((field) => [field, location[field]]),
  ) as PhotoFields;
}
export function imageHash(location: Location) {
  return mediaHash(imageFields(location));
}
function safeHttps(value: unknown): boolean {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
function within(root: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").includes("..")
  )
    throw new Error("Asset path must stay inside the asset root");
  const resolved = path.resolve(root, relative);
  const canonicalRoot = realpathSync(root);
  if (!existsSync(resolved)) throw new Error("Asset file is missing");
  const canonical = realpathSync(resolved);
  if (!canonical.startsWith(`${canonicalRoot}${path.sep}`))
    throw new Error("Asset path escapes the asset root");
  return canonical;
}
function validateReview(review: MediaReview): string[] {
  const errors: string[] = [];
  for (const field of [
    "researchId",
    "assetPath",
    "creator",
    "license",
    "attribution",
    "reviewer",
    "subjectDescription",
    "exactFileEvidence",
    "rightsEvidence",
    "transformations",
    "shareAlike",
  ] as const) {
    if (typeof review[field] !== "string" || !review[field].trim())
      errors.push(`Missing ${field}`);
  }
  for (const field of [
    "sha256",
    "originalAssetSha256",
    "sourceEvidenceSha256",
  ] as const)
    if (!/^[a-f0-9]{64}$/.test(review[field] ?? ""))
      errors.push(`Invalid ${field}`);
  for (const field of ["sourcePage", "originalAssetUrl", "licenseUrl"] as const)
    if (!safeHttps(review[field])) errors.push(`Invalid ${field}`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt ?? "") ||
    !Number.isFinite(Date.parse(review.reviewedAt))
  )
    errors.push("Invalid review date");
  const cc = /^CC BY(-SA)? ([1-4]\.0)$/.exec(review.license ?? "");
  if (
    cc &&
    String(review.licenseUrl ?? "").replace(/\/$/, "") !==
      `https://creativecommons.org/licenses/by${cc[1] ? "-sa" : ""}/${cc[2]}`
  )
    errors.push("License URL does not match the stated CC license version");
  if (
    review.license === "CC0 1.0" &&
    String(review.licenseUrl ?? "").replace(/\/$/, "") !==
      "https://creativecommons.org/publicdomain/zero/1.0"
  )
    errors.push("License URL does not match CC0 1.0");
  if (
    review.exactFileVerified !== true ||
    review.visualSubjectVerified !== true ||
    review.rightsVerified !== true
  )
    errors.push("Exact-file, subject and rights review must all be complete");
  if (
    /unknown|advisory|pending|reference.?only|no known restrictions/i.test(
      review.license ?? "",
    )
  )
    errors.push("License is not cleared for installation");
  if (
    !/^CC BY(?:-SA)? [1-4]\.0$|^CC0 1\.0$|^Public domain \(.+\)$|^Attribution permission \(.+\)$/.test(
      review.license ?? "",
    )
  )
    errors.push(
      "License needs an explicit supported name and version or public-domain basis",
    );
  if (
    /^CC BY-SA/.test(review.license ?? "") &&
    !/same|share|compatible/i.test(review.shareAlike ?? "")
  )
    errors.push("ShareAlike obligations must be explicit");
  if (
    QUARANTINED_RESEARCH_IDS.has(review.researchId) &&
    review.correctedQuarantinedChoice !== true
  )
    errors.push(
      "Known source/image mismatch: a corrected exact-file patch is required",
    );
  return errors;
}
/** Applies only image fields to the CURRENT record. Narrative edits never get replaced by a photo patch. */
export function applyMediaFields(
  current: Location,
  patch: PhotoPatch,
): Location {
  if (current.id !== patch.appId)
    throw new Error("Photo patch identity mismatch");
  const keys = Object.keys(patch.fields).sort();
  if (stable(keys) !== stable([...PHOTO_FIELDS].sort()))
    throw new Error("Photo-only patch contains unsupported fields");
  if (mediaHash(patch.fields) !== patch.afterImageHash)
    throw new Error("Photo patch after hash mismatch");
  if (imageHash(current) === patch.afterImageHash) return current;
  if (imageHash(current) !== patch.beforeImageHash)
    throw new Error(
      "Photo conflict: current image fields changed since planning",
    );
  const next = { ...current, ...patch.fields };
  validateLocation(next);
  return next;
}
/** For rollback, apply the stored before fields with a beforeImageHash equal to the installed image hash. */
export function reversePhotoPatch(
  patch: PhotoPatch,
  before: Location,
): PhotoPatch {
  if (before.id !== patch.appId || imageHash(before) !== patch.beforeImageHash)
    throw new Error("Invalid photo rollback snapshot");
  return {
    appId: patch.appId,
    researchId: patch.researchId,
    beforeImageHash: patch.afterImageHash,
    afterImageHash: patch.beforeImageHash,
    fields: imageFields(before),
  };
}
export async function buildPhotoPatchPlan(
  currentCatalog: Location[],
  manifest: PhotoPatchManifest,
  assetRoot: string,
  crosswalk: PhotoCrosswalk[],
): Promise<MediaPlan> {
  if (
    !manifest.patchVersion ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(manifest.patchVersion)
  )
    throw new Error("A stable patchVersion is required");
  if (!Array.isArray(manifest.reviews))
    throw new Error("Photo patch reviews must be an array");
  const byResearch = new Map<string, string>();
  const byApp = new Map(currentCatalog.map((x) => [x.id, x]));
  for (const row of crosswalk) {
    const appId = row.preserve_app_id || row.canonical_site_id;
    if (byResearch.has(row.research_id))
      throw new Error(`Duplicate research identity: ${row.research_id}`);
    byResearch.set(row.research_id, appId);
  }
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const review of manifest.reviews) {
    const key = byResearch.get(review.researchId) ?? review.researchId;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  const records: MediaPlanRecord[] = [];
  const assetCopies: MediaPlan["assetCopies"] = [];
  for (const review of [...manifest.reviews].sort((a, b) =>
    a.researchId.localeCompare(b.researchId),
  )) {
    const appId = byResearch.get(review.researchId) ?? null;
    const base: MediaPlanRecord = {
      researchId: review.researchId,
      appId,
      disposition: "rejected",
      reasons: [],
      review,
    };
    if (!appId || !byApp.has(appId)) {
      records.push({
        ...base,
        disposition: "deferred",
        reasons: ["Stable app identity is not present in the current catalog"],
      });
      continue;
    }
    if (duplicates.has(appId)) {
      records.push({
        ...base,
        disposition: "conflicted",
        reasons: ["Multiple photo choices target the same app identity"],
      });
      continue;
    }
    const errors = validateReview(review);
    if (errors.length) {
      records.push({ ...base, reasons: errors });
      continue;
    }
    let source: string;
    let assetExtension: string;
    try {
      source = within(assetRoot, review.assetPath);
      const bytes = readFileSync(source);
      if (createHash("sha256").update(bytes).digest("hex") !== review.sha256)
        throw new Error("Asset SHA-256 does not match reviewed bytes");
      const decoder = sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 80_000_000,
      });
      const metadata = await decoder.metadata();
      const format =
        metadata.format === "heif" && metadata.compression === "av1"
          ? "avif"
          : metadata.format;
      if (
        !format ||
        !["jpeg", "png", "webp", "avif"].includes(format) ||
        (metadata.pages ?? 1) > 1
      )
        throw new Error(
          "Only decoded static JPEG, PNG, WebP or AVIF assets are supported",
        );
      await decoder.stats();
      assetExtension = format === "jpeg" ? "jpg" : format;
    } catch (error) {
      records.push({
        ...base,
        reasons: [String(error instanceof Error ? error.message : error)],
      });
      continue;
    }
    const current = byApp.get(appId)!;
    const destination = `images/research/${review.sha256}.${assetExtension}`;
    const fields: PhotoFields = {
      image: `/${destination}`,
      imageAlt: review.subjectDescription,
      imageCredit: review.attribution,
      imageLicense: review.license,
      imageSource: review.sourcePage,
    };
    const patch: PhotoPatch = {
      appId,
      researchId: review.researchId,
      beforeImageHash: imageHash(current),
      afterImageHash: mediaHash(fields),
      fields,
    };
    if (patch.beforeImageHash === patch.afterImageHash) {
      records.push({
        ...base,
        disposition: "unchanged",
        patch,
        reasons: ["Identical asset and image metadata already installed"],
      });
      continue;
    }
    if (
      !current.image.endsWith("/location-placeholder.svg") &&
      review.replaceExisting !== true
    ) {
      records.push({
        ...base,
        disposition: "deferred",
        reasons: [
          "Existing approved image preserved; replacement needs explicit review",
        ],
      });
      continue;
    }
    try {
      const nextLocation = applyMediaFields(current, patch);
      records.push({
        ...base,
        disposition: "updated",
        reasons: [],
        patch,
        nextLocation,
      });
      assetCopies.push({
        source,
        destination,
        sha256: review.sha256,
        researchId: review.researchId,
      });
    } catch (error) {
      records.push({
        ...base,
        reasons: [String(error instanceof Error ? error.message : error)],
      });
    }
  }
  const summary = {
    updated: 0,
    unchanged: 0,
    deferred: 0,
    conflicted: 0,
    rejected: 0,
  };
  for (const row of records) summary[row.disposition]++;
  const result = {
    importerVersion: MEDIA_IMPORTER_VERSION,
    patchVersion: manifest.patchVersion,
    manifestHash: mediaHash(manifest),
    records,
    assetCopies,
    summary,
  };
  return {
    ...result,
    planHash: mediaHash({
      ...result,
      assetCopies: assetCopies.map(({ source: _source, ...item }) => item),
    }),
  };
}

/** Optional independently verified reviews unlock assets; package workflow labels never unlock an asset. */
export async function buildNationwideMediaPlan(
  inputRoot: string,
  currentCatalog: Location[],
  options: { reviewsPath?: string; patchVersion?: string } = {},
): Promise<MediaPlan> {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(path.join(inputRoot, "index", `${name}.json`), "utf8"),
    );
  const photoIndex = read("PHOTO_INDEX") as {
    research_id: string;
    normalized_status: string;
    metadata?: Record<string, unknown>;
  }[];
  const crosswalk = read("GLOBAL_ID_CROSSWALK") as PhotoCrosswalk[];
  const manifest: PhotoPatchManifest = options.reviewsPath
    ? JSON.parse(readFileSync(options.reviewsPath, "utf8"))
    : {
        patchVersion:
          options.patchVersion ?? "nationwide-2026-10-12-unreviewed",
        reviews: [],
      };
  if (options.patchVersion && manifest.patchVersion !== options.patchVersion)
    throw new Error(
      "Requested patch version does not match the review manifest",
    );
  const plan = await buildPhotoPatchPlan(
    currentCatalog,
    manifest,
    inputRoot,
    crosswalk,
  );
  const reviewed = new Set(plan.records.map((x) => x.researchId));
  const ids = new Map(
    crosswalk.map((row) => [
      row.research_id,
      row.preserve_app_id || row.canonical_site_id,
    ]),
  );
  for (const photo of photoIndex) {
    if (reviewed.has(photo.research_id)) continue;
    plan.records.push({
      researchId: photo.research_id,
      appId: ids.get(photo.research_id) ?? null,
      disposition: "deferred",
      reasons: [
        QUARANTINED_RESEARCH_IDS.has(photo.research_id)
          ? "Quarantined: known source/image rights mismatch; corrected exact-file patch required"
          : `No completed independent exact-file review; historical status: ${photo.normalized_status}`,
      ],
    });
    plan.summary.deferred++;
  }
  plan.records.sort((a, b) => a.researchId.localeCompare(b.researchId));
  plan.planHash = mediaHash({
    importerVersion: plan.importerVersion,
    patchVersion: plan.patchVersion,
    manifestHash: plan.manifestHash,
    records: plan.records,
    assetCopies: plan.assetCopies.map(({ source: _source, ...item }) => item),
    summary: plan.summary,
  });
  return plan;
}
