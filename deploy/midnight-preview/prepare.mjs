import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateConfig } from "./validate-config.mjs";
import {
  installPhotoAssets,
  validateAssetLimits,
  verifyPhotoWorkspace,
} from "./photo-assets.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));
const generated = fileURLToPath(new URL("./.generated/", import.meta.url));
const preservedPhaseOne = "9da89485891f07d584a426d487f707af6ef06f46";
const preservedPhaseOneOne = "cf915ba2c39856346ceb087e374f2f371cc327ca";
const preservedMidnightSeance = "d3c7a21db5c7e8134b81c7603eef274a0adbcf73";
const preservedAtmosphericFog = "8ffeb28e4e36a4fb2169f1fbcbf1d23b2c75e839";
let allowDirty = false;
let photoWorkspace;
let photoPatchVersion;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--allow-dirty" && !allowDirty) allowDirty = true;
  else if (
    arg === "--photo-workspace" &&
    !photoWorkspace &&
    argv[i + 1] &&
    !argv[i + 1].startsWith("--")
  )
    photoWorkspace = argv[++i];
  else if (
    arg === "--photo-patch-version" &&
    !photoPatchVersion &&
    argv[i + 1] &&
    !argv[i + 1].startsWith("--")
  )
    photoPatchVersion = argv[++i];
  else
    throw new Error(
      "Usage: node deploy/midnight-preview/prepare.mjs [--allow-dirty] [--photo-workspace PATH [--photo-patch-version VERSION]]",
    );
}
if (photoPatchVersion && !photoWorkspace)
  throw new Error("--photo-patch-version requires --photo-workspace");
validateConfig();
const git = (...args) =>
  execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
const branch = git("branch", "--show-current");
const commit = git("rev-parse", "HEAD");
if (
  ![
    "dev/phasm-editorial-voice",
    "codex/usa-atlas-130",
    "codex/rolling-fog",
    "codex/responsive-performance",
    "codex/volumetric-mist",
    "codex/nationwide-research-2853",
  ].includes(branch)
)
  throw new Error(
    "Preview requires a reviewed editorial, atlas, fog or performance branch.",
  );
if (branch === "codex/nationwide-research-2853" && !photoWorkspace)
  throw new Error(
    "Nationwide preparation requires --photo-workspace so reviewed catalog images are included.",
  );
git("merge-base", "--is-ancestor", preservedPhaseOne, "HEAD");
git("merge-base", "--is-ancestor", preservedPhaseOneOne, "HEAD");
git("merge-base", "--is-ancestor", preservedMidnightSeance, "HEAD");
git("merge-base", "--is-ancestor", preservedAtmosphericFog, "HEAD");
const dirty = Boolean(git("status", "--porcelain", "--untracked-files=normal"));
if (dirty && !allowDirty)
  throw new Error(
    "Commit reviewed changes before preparing a deployment. --allow-dirty is available only for local dry-run checks.",
  );

const verifiedPhotos = photoWorkspace
  ? verifyPhotoWorkspace(photoWorkspace, photoPatchVersion)
  : null;

// Always rebuild so the provenance matches the application being packaged.
execFileSync("npm", ["run", "build"], { cwd: source, stdio: "inherit" });
if (!existsSync(join(source, "dist/phasm/index.js")))
  throw new Error("The application Worker build is missing.");
rmSync(generated, { recursive: true, force: true });
mkdirSync(generated, { recursive: true });
cpSync(join(source, "dist/client"), join(generated, "assets"), {
  recursive: true,
});
const photos = verifiedPhotos
  ? installPhotoAssets(verifiedPhotos, join(generated, "assets"))
  : null;
const headersFile = join(generated, "assets/_headers");
const originalHeaders = readFileSync(headersFile, "utf8");
if (!originalHeaders.startsWith("/*\n"))
  throw new Error("Expected the application's global response headers.");
writeFileSync(
  headersFile,
  originalHeaders.replace(
    "/*\n",
    "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n",
  ),
);
const assetLimits = validateAssetLimits(join(generated, "assets"));
writeFileSync(
  join(generated, "source.json"),
  JSON.stringify(
    {
      branch,
      commit,
      preservedPhaseOne,
      preservedPhaseOneOne,
      preservedMidnightSeance,
      preservedAtmosphericFog,
      dirty,
      photos,
      assetLimits,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${branch} at ${commit}${dirty ? " (uncommitted changes: local dry-run only)" : ""}.`,
);
