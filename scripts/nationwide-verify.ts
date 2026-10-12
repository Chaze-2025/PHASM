import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

type Row = Record<string, any>;
export const nationwideVerifierVersion = "1.0.0";
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

/** RFC 6901 pointer decoding; rejects inherited properties and invalid array indexes. */
export function resolveJsonPointer(
  document: unknown,
  pointer: string,
): unknown {
  if (pointer === "") return document;
  if (typeof pointer !== "string" || !pointer.startsWith("/"))
    throw new Error("Invalid JSON pointer");
  let current: any = document;
  for (const encoded of pointer.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(encoded))
      throw new Error("Invalid JSON pointer escape");
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(key))
      throw new Error("Invalid JSON pointer array index");
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, key)
    )
      throw new Error("JSON pointer does not resolve");
    current = current[key];
  }
  return current;
}

/** Package paths never traverse symlinks, even when a link resolves inside the package. */
export function safePackagePath(root: string, value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    /[\\\0]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Unsafe package path: ${String(value)}`);
  const filename = resolve(root, value);
  if (relative(root, filename).startsWith(`..${sep}`))
    throw new Error(`Package path escapes root: ${value}`);
  let part = root;
  for (const segment of value.split("/")) {
    part = join(part, segment);
    try {
      if (lstatSync(part).isSymbolicLink())
        throw new Error(`Symlink prohibited: ${value}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return filename;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (char === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export interface VerifyOptions {
  allowMissingImages?: string[];
  /** Data-only means every image is explicitly expected absent, and none may be present. */
  dataOnly?: boolean;
  archive?: string;
  archiveSha256?: string;
}

export function verifyNationwidePackage(
  inputRoot: string,
  options: VerifyOptions = {},
) {
  const errors: string[] = [];
  const root = resolve(inputRoot);
  const result = {
    verifierVersion: nationwideVerifierVersion,
    ok: false,
    completeBundle: false,
    mode: options.dataOnly ? "data-only" : "explicit-image-omissions",
    inputHash: "",
    profileIndexHash: "",
    archiveHash: null as string | null,
    checksumEntries: 0,
    filesVerified: 0,
    profiles: 0,
    states: 0,
    baselineIdentities: 0,
    proposedAdditions: 0,
    imageFilesExpected: 0,
    imageFilesPresent: 0,
    missingImages: [] as string[],
    stateCounts: {} as Record<string, number>,
    errors,
  };
  const fail = (message: string) => {
    errors.push(message);
  };
  try {
    if (
      !lstatSync(root).isDirectory() ||
      lstatSync(root).isSymbolicLink() ||
      realpathSync(root) !== root
    )
      throw new Error(
        "Package root must be a real directory without symlink components",
      );
    if (Boolean(options.archive) !== Boolean(options.archiveSha256))
      throw new Error(
        "Archive verification requires both archive path and expected SHA-256",
      );
    if (options.archive) {
      if (!/^[0-9a-f]{64}$/.test(options.archiveSha256!))
        throw new Error("Invalid archive SHA-256");
      result.archiveHash = sha256(readFileSync(options.archive));
      if (result.archiveHash !== options.archiveSha256)
        fail("Archive SHA-256 mismatch");
    }
    const checksums = readFileSync(safePackagePath(root, "CHECKSUMS.sha256"));
    // Hash the exact immutable checksum manifest bytes: photo arrival does not change content identity.
    result.inputHash = sha256(checksums);
    const hashes = new Map<string, string>();
    for (const line of checksums
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      if (!match) throw new Error("Malformed checksum manifest entry");
      safePackagePath(root, match[2]);
      if (hashes.has(match[2]))
        throw new Error(`Repeated checksum path: ${match[2]}`);
      hashes.set(match[2], match[1]);
    }
    result.checksumEntries = hashes.size;
    const missing = new Set<string>();
    for (const [filename, expected] of hashes) {
      const absolute = safePackagePath(root, filename);
      try {
        if (!lstatSync(absolute).isFile())
          throw new Error(`Not a regular file: ${filename}`);
        if (sha256(readFileSync(absolute)) !== expected)
          fail(`Hash mismatch: ${filename}`);
        else result.filesVerified++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          missing.add(filename);
        else throw error;
      }
    }
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const filename = join(directory, entry.name);
        const local = relative(root, filename).split(sep).join("/");
        safePackagePath(root, local);
        if (entry.isDirectory()) walk(filename);
        else if (!entry.isFile()) fail(`Not a regular package file: ${local}`);
        else if (local !== "CHECKSUMS.sha256" && !hashes.has(local))
          fail(`Unmanifested package file: ${local}`);
      }
    };
    walk(root);
    const cache = new Map<string, any>();
    const json = (filename: string): any => {
      if (!hashes.has(filename))
        throw new Error(`Referenced file absent from manifest: ${filename}`);
      if (!cache.has(filename))
        cache.set(
          filename,
          JSON.parse(readFileSync(safePackagePath(root, filename), "utf8")),
        );
      return cache.get(filename);
    };
    const list = (filename: string): Row[] => {
      const rows = json(filename);
      if (!Array.isArray(rows)) throw new Error(`Expected array: ${filename}`);
      return rows;
    };
    const manifest = json("MANIFEST.json");
    const images = list("index/INCLUDED_IMAGE_FILES.json");
    const imagePaths = new Set(images.map((row) => row.path));
    if (imagePaths.size !== images.length) fail("Repeated included image path");
    result.imageFilesExpected = images.length;
    const allowed = new Set(
      options.dataOnly ? [...imagePaths] : (options.allowMissingImages ?? []),
    );
    if (options.dataOnly && options.allowMissingImages?.length)
      fail("Do not combine dataOnly with individual missing images");
    for (const path of allowed) {
      safePackagePath(root, path);
      if (!imagePaths.has(path))
        fail(`Only indexed images may be allowed missing: ${path}`);
      if (!missing.has(path))
        fail(`Expected missing image is present: ${path}`);
    }
    for (const path of missing) {
      if (imagePaths.has(path)) result.missingImages.push(path);
      if (!allowed.has(path)) fail(`Unexpected missing file: ${path}`);
    }
    result.missingImages.sort();
    for (const row of images) {
      if (hashes.get(row.path) !== row.sha256)
        fail(`Image index/checksum disagreement: ${row.path}`);
      if (!missing.has(row.path)) {
        result.imageFilesPresent++;
        if (lstatSync(safePackagePath(root, row.path)).size !== row.bytes)
          fail(`Image byte count mismatch: ${row.path}`);
      }
    }
    if (manifest.included_subject_qa_image_files !== images.length)
      fail("Manifest image count mismatch");
    const profiles = list("index/PROFILE_INDEX.json");
    result.profileIndexHash = sha256(
      readFileSync(safePackagePath(root, "index/PROFILE_INDEX.json")),
    );
    const originals = list("index/ORIGINAL_RECORDS_WITH_INDEX.json");
    const globals = list("index/GLOBAL_ID_CROSSWALK.json");
    const baseline = list("index/BASELINE_CROSSWALK.json");
    const uniqueMap = (
      rows: Row[],
      key: (row: Row) => string,
      label: string,
    ) => {
      const map = new Map<string, Row>();
      for (const row of rows) {
        const id = key(row);
        if (typeof id !== "string" || !id || map.has(id))
          fail(`Invalid or repeated ${label}: ${id}`);
        map.set(id, row);
      }
      return map;
    };
    const byId = uniqueMap(profiles, (row) => row.research_id, "research ID");
    const raw = uniqueMap(
      originals,
      (row) => row.index?.research_id,
      "original-envelope ID",
    );
    const crosswalk = uniqueMap(
      globals,
      (row) => row.research_id,
      "global crosswalk ID",
    );
    uniqueMap(globals, (row) => row.canonical_site_id, "canonical ID");
    uniqueMap(baseline, (row) => row.preserve_app_id, "preserved app ID");
    uniqueMap(
      profiles,
      (row) => `${row.source_file}#${row.record_pointer}`,
      "profile pointer",
    );
    const resolveRecord = (row: Row) =>
      resolveJsonPointer(json(row.source_file), row.record_pointer);
    for (const row of profiles) {
      try {
        const original = resolveRecord(row);
        if (
          !isDeepStrictEqual(
            original,
            raw.get(row.research_id)?.original_record,
          )
        )
          fail(`Original record mismatch: ${row.research_id}`);
        if (!isDeepStrictEqual(row, raw.get(row.research_id)?.index))
          fail(`Envelope index mismatch: ${row.research_id}`);
        const global = crosswalk.get(row.research_id);
        for (const key of [
          "canonical_site_id",
          "preserve_app_id",
          "source_file",
          "record_pointer",
        ])
          if (row[key] !== global?.[key])
            fail(`Crosswalk ${key} mismatch: ${row.research_id}`);
        if (row.photo_search_supplement) {
          const supplement = resolveRecord(row.photo_search_supplement) as Row;
          if (
            (supplement?.research_id ??
              supplement?.profile_id ??
              supplement?.provisional_id) !== row.research_id
          )
            fail(`Photo supplement identity mismatch: ${row.research_id}`);
        }
        if (typeof row.state !== "string" || !row.state)
          fail(`Missing state: ${row.research_id}`);
        else
          result.stateCounts[row.state] =
            (result.stateCounts[row.state] ?? 0) + 1;
      } catch (error) {
        fail(
          `Profile ${row.research_id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    for (const row of baseline) {
      const ids = row.research_record_ids;
      if (
        row.match_count !== 1 ||
        !Array.isArray(ids) ||
        ids.length !== 1 ||
        byId.get(ids?.[0])?.preserve_app_id !== row.preserve_app_id ||
        !row.original_record_present
      )
        fail(`Invalid baseline identity coverage: ${row.preserve_app_id}`);
    }
    const baselineProfiles = profiles.filter((row) => row.preserve_app_id);
    const appIds = new Set(baselineProfiles.map((row) => row.preserve_app_id));
    if (
      appIds.size !== baselineProfiles.length ||
      baseline.length !== baselineProfiles.length
    )
      fail("Baseline profile coverage mismatch");
    const catalog = list("baseline/repository-catalog-136.json");
    const us = catalog.filter((row) => row.country === "United States");
    if (us.length !== baseline.length || us.some((row) => !appIds.has(row.id)))
      fail("Baseline app catalog coverage mismatch");
    const photos = list("index/PHOTO_INDEX.json");
    const photosById = uniqueMap(
      photos,
      (row) => row.research_id,
      "photo index ID",
    );
    if (
      photos.length !== profiles.length ||
      profiles.some((row) => !photosById.has(row.research_id))
    )
      fail("Photo profile coverage mismatch");
    const validation = json("index/VALIDATION.json");
    result.profiles = profiles.length;
    result.states = Object.keys(result.stateCounts).length;
    result.baselineIdentities = baseline.length;
    result.proposedAdditions = profiles.length - baseline.length;
    if (
      profiles.length !== manifest.profiles ||
      profiles.length !== validation.state_record_total ||
      originals.length !== profiles.length ||
      globals.length !== profiles.length
    )
      fail("Profile total mismatch");
    if (
      result.states !== manifest.states ||
      result.states !== validation.states_indexed
    )
      fail("State total mismatch");
    if (
      baseline.length !== manifest.baseline_identities ||
      baseline.length !== validation.baseline_records_indexed
    )
      fail("Baseline total mismatch");
    if (result.proposedAdditions !== manifest.proposed_additions)
      fail("Proposed-addition count mismatch");
    const countPath = "index/STATE_COUNTS.csv";
    if (!hashes.has(countPath))
      throw new Error("State counts absent from manifest");
    const [header, ...counts] = csvRows(
      readFileSync(safePackagePath(root, countPath), "utf8"),
    );
    const stateColumn = header.indexOf("state"),
      totalColumn = header.indexOf("profiles");
    if (stateColumn < 0 || totalColumn < 0 || counts.length !== result.states)
      fail("Invalid state-count CSV");
    const seenStates = new Set<string>();
    for (const row of counts) {
      const state = row[stateColumn];
      if (
        seenStates.has(state) ||
        Number(row[totalColumn]) !== result.stateCounts[state]
      )
        fail(`CSV state count mismatch: ${state}`);
      seenStates.add(state);
    }
    result.completeBundle = missing.size === 0 && errors.length === 0;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  result.ok = errors.length === 0;
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2),
      options: VerifyOptions = { allowMissingImages: [] };
    let input = "",
      report: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === "--data-only") options.dataOnly = true;
      else if (
        [
          "--input",
          "--allow-missing-image",
          "--zip",
          "--zip-sha256",
          "--report",
        ].includes(flag)
      ) {
        const value = args[++i];
        if (!value || value.startsWith("--"))
          throw new Error(`Missing value for ${flag}`);
        if (flag === "--input") input = value;
        else if (flag === "--allow-missing-image")
          options.allowMissingImages!.push(value);
        else if (flag === "--zip") options.archive = value;
        else if (flag === "--zip-sha256") options.archiveSha256 = value;
        else report = value;
      } else throw new Error(`Unknown argument: ${flag}`);
    }
    if (!input)
      throw new Error(
        "Usage: tsx scripts/nationwide-verify.ts --input DIRECTORY [--allow-missing-image EXACT_PATH] [--data-only] [--zip FILE --zip-sha256 HASH] [--report FILE]",
      );
    if (
      report &&
      (resolve(report) === resolve(input) ||
        resolve(report).startsWith(`${resolve(input)}${sep}`))
    )
      throw new Error(
        "Verification report must be outside the immutable input package",
      );
    const result = verifyNationwidePackage(input, options);
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (report) writeFileSync(resolve(report), output);
    process.stdout.write(output);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
