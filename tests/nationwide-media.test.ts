import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Location } from "../shared/types";
import {
  applyMediaFields,
  buildPhotoPatchPlan,
  imageFields,
  imageHash,
  reversePhotoPatch,
  mediaHash,
  type MediaReview,
  type PhotoPatch,
} from "../scripts/nationwide-media";
const sourceLocation = JSON.parse(
  readFileSync("content/locations.json", "utf8"),
)[0] as Location;
async function fixture(t: { after: (f: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "phasm-media-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#d5ccb0" },
  })
    .jpeg()
    .toBuffer();
  writeFileSync(path.join(root, "photo.jpg"), bytes);
  const current: Location = {
    ...sourceLocation,
    id: "site",
    slug: "site",
    image: "/images/location-placeholder.svg",
  };
  const review: MediaReview = {
    researchId: "research-site",
    assetPath: "photo.jpg",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourcePage: "https://example.com/file",
    originalAssetUrl: "https://example.com/photo.jpg",
    originalAssetSha256: "1".repeat(64),
    sourceEvidenceSha256: "2".repeat(64),
    creator: "Example photographer",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution:
      "Example photographer / CC BY-SA 4.0 / resized; display may crop",
    reviewedAt: "2026-10-12",
    reviewer: "Test review",
    subjectDescription: "The named site exterior.",
    exactFileEvidence: "Source page links exact reviewed bytes.",
    rightsEvidence: "File-specific CC license verified.",
    transformations: "Unmodified source pixels; display may crop.",
    shareAlike: "Adaptations require the same or compatible license.",
    exactFileVerified: true,
    visualSubjectVerified: true,
    rightsVerified: true,
  };
  const crosswalk = [
    {
      research_id: "research-site",
      canonical_site_id: "research-site",
      preserve_app_id: "site",
    },
  ];
  const plan = (r: MediaReview[] = [review], catalog = [current]) =>
    buildPhotoPatchPlan(
      catalog,
      { patchVersion: "test-v1", reviews: r },
      root,
      crosswalk,
    );
  return { root, current, review, plan, crosswalk };
}
test("reviewed photo patch changes only five image fields and uses stable app identity", async (t) => {
  const f = await fixture(t);
  const plan = await f.plan();
  const result = plan.records[0];
  assert.equal(result.disposition, "updated");
  assert.equal(result.appId, "site");
  assert.equal(plan.assetCopies.length, 1);
  assert.match(plan.assetCopies[0].destination, /[a-f0-9]{64}\.jpg$/);
  const next = result.nextLocation!;
  for (const [key, value] of Object.entries(f.current))
    if (!(key in imageFields(next)))
      assert.deepEqual(next[key as keyof Location], value, key);
  assert.equal(next.updatedAt, f.current.updatedAt);
  assert.equal(next.status, f.current.status);
});
test("identical repeated patch makes no content, timestamp, or asset changes", async (t) => {
  const f = await fixture(t);
  const first = await f.plan();
  const current = first.records[0].nextLocation!;
  const second = await f.plan([f.review], [current]);
  assert.equal(second.records[0].disposition, "unchanged");
  assert.deepEqual(second.assetCopies, []);
  assert.strictEqual(
    applyMediaFields(current, first.records[0].patch!),
    current,
  );
  assert.deepEqual(await f.plan(), first);
});
test("photo rollback reverses only image changes and preserves newer narrative edits", async (t) => {
  const f = await fixture(t);
  const row = (await f.plan()).records[0];
  const edited = {
    ...row.nextLocation!,
    history: "A newer editorial history.",
    updatedAt: "2026-10-13",
  };
  const restored = applyMediaFields(
    edited,
    reversePhotoPatch(row.patch!, f.current),
  );
  assert.deepEqual(imageFields(restored), imageFields(f.current));
  assert.equal(restored.history, edited.history);
  assert.equal(restored.updatedAt, edited.updatedAt);
});
test("current image edits conflict but current narrative edits are preserved", async (t) => {
  const f = await fixture(t);
  const patch = (await f.plan()).records[0].patch!;
  assert.throws(
    () =>
      applyMediaFields({ ...f.current, imageCredit: "A newer credit" }, patch),
    /conflict/,
  );
  const current = { ...f.current, reports: "New attributed report." };
  assert.equal(applyMediaFields(current, patch).reports, current.reports);
});
test("photo patch cannot replace narrative or identity fields", async (t) => {
  const f = await fixture(t);
  const patch = (await f.plan()).records[0].patch!;
  const forged = {
    ...patch,
    fields: { ...patch.fields, history: "Injected replacement" },
  } as PhotoPatch;
  forged.afterImageHash = mediaHash(forged.fields);
  assert.throws(
    () => applyMediaFields(f.current, forged),
    /unsupported fields/,
  );
  assert.throws(
    () => applyMediaFields({ ...f.current, id: "other" }, patch),
    /identity mismatch/,
  );
});
test("existing approved images are preserved unless replacement is explicitly reviewed", async (t) => {
  const f = await fixture(t);
  const baseline = { ...f.current, image: "/images/approved.webp" };
  assert.equal(
    (await f.plan([f.review], [baseline])).records[0].disposition,
    "deferred",
  );
  assert.equal(
    (await f.plan([{ ...f.review, replaceExisting: true }], [baseline]))
      .records[0].disposition,
    "updated",
  );
});
test("historical visual-pending status and absent exact-file proof never unlock assets", async (t) => {
  const f = await fixture(t);
  for (const flag of [
    "exactFileVerified",
    "visualSubjectVerified",
    "rightsVerified",
  ]) {
    const result = await f.plan([{ ...f.review, [flag]: false }]);
    assert.equal(result.records[0].disposition, "rejected");
    assert.deepEqual(result.assetCopies, []);
  }
  assert.equal(
    (await f.plan([{ ...f.review, sourceEvidenceSha256: "" }])).records[0]
      .disposition,
    "rejected",
  );
});
test("unknown, advisory, and wrong source URLs remain quarantined", async (t) => {
  const f = await fixture(t);
  for (const change of [
    { license: "No known restrictions (advisory)" },
    { sourcePage: "javascript:alert(1)" },
    { licenseUrl: "https://user:pass@example.com/license" },
    { originalAssetUrl: "http://example.com/file.jpg" },
  ]) {
    assert.equal(
      (await f.plan([{ ...f.review, ...change }])).records[0].disposition,
      "rejected",
    );
  }
});
test("all three known Wyoming mismatches require a corrected exact-file patch", async (t) => {
  const f = await fixture(t);
  for (const researchId of [
    "phasm-us-wy-st-marks-episcopal-church",
    "phasm-us-wy-virginian-hotel",
    "phasm-us-wy-cheyenne-masonic-temple",
  ]) {
    const crosswalk = [{ research_id: researchId, canonical_site_id: "site" }];
    const result = await buildPhotoPatchPlan(
      [f.current],
      { patchVersion: "wy-v1", reviews: [{ ...f.review, researchId }] },
      f.root,
      crosswalk,
    );
    assert.equal(result.records[0].disposition, "rejected");
    assert.match(
      result.records[0].reasons.join(" "),
      /Known source\/image mismatch/,
    );
  }
});
test("asset integrity and decoder failures reject the patch", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.plan([{ ...f.review, sha256: "3".repeat(64) }])).records[0]
      .disposition,
    "rejected",
  );
  const corrupt = Buffer.from([255, 216, 0, 255, 217]);
  writeFileSync(path.join(f.root, "photo.jpg"), corrupt);
  const result = await f.plan([
    { ...f.review, sha256: createHash("sha256").update(corrupt).digest("hex") },
  ]);
  assert.equal(result.records[0].disposition, "rejected");
  assert.equal(result.assetCopies.length, 0);
});
test("absolute paths, traversal, and symlink escapes cannot be installed", async (t) => {
  const f = await fixture(t);
  symlinkSync("/etc/hosts", path.join(f.root, "escape.jpg"));
  for (const assetPath of ["/etc/hosts", "../photo.jpg", "escape.jpg"])
    assert.equal(
      (await f.plan([{ ...f.review, assetPath }])).records[0].disposition,
      "rejected",
    );
});
test("duplicate choices and unknown identities cannot silently target a different site", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    (await f.plan([f.review, f.review])).records.map((x) => x.disposition),
    ["conflicted", "conflicted"],
  );
  assert.equal(
    (await f.plan([{ ...f.review, researchId: "missing" }])).records[0]
      .disposition,
    "deferred",
  );
});
test("rollback refuses a concurrent image change and a wrong before snapshot", async (t) => {
  const f = await fixture(t);
  const row = (await f.plan()).records[0];
  const reverse = reversePhotoPatch(row.patch!, f.current);
  assert.throws(
    () =>
      applyMediaFields(
        { ...row.nextLocation!, imageCredit: "Later editor" },
        reverse,
      ),
    /conflict/,
  );
  assert.throws(
    () =>
      reversePhotoPatch(row.patch!, {
        ...f.current,
        imageCredit: "Wrong backup",
      }),
    /Invalid photo rollback/,
  );
  assert.equal(imageHash(f.current), row.patch!.beforeImageHash);
});

test("CC license links must match the reviewed license and version", async (t) => {
  const f = await fixture(t);
  const plan = await f.plan([
    {
      ...f.review,
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    },
  ]);
  assert.equal(plan.records[0].disposition, "rejected");
  assert.match(plan.records[0].reasons.join(" "), /does not match/);
});

test("future PNG, WebP and AVIF patches use decoded formats and preserve exact bytes", async (t) => {
  const f = await fixture(t);
  for (const format of ["png", "webp", "avif"] as const) {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#224466" },
    })
      .toFormat(format)
      .toBuffer();
    const filename = `photo.${format}`;
    writeFileSync(path.join(f.root, filename), bytes);
    const plan = await f.plan([
      {
        ...f.review,
        assetPath: filename,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ]);
    assert.equal(plan.records[0].disposition, "updated", format);
    assert.equal(
      plan.assetCopies[0].destination,
      `images/research/${createHash("sha256").update(bytes).digest("hex")}.${format}`,
    );
    assert.deepEqual(readFileSync(path.join(f.root, filename)), bytes);
  }
});
