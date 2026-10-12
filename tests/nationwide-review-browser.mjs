/** Read-only checks against the isolated preview. Never run against live data.
 * PHASM_BASE_URL=http://127.0.0.1:5181 ADMIN_TOKEN=<local credential>
 * PHASM_SCREENSHOT_DIR=/private/artifact/directory node tests/nationwide-review-browser.mjs
 * The credential is never persisted in browser storage, screenshots, or reports.
 */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.PHASM_BASE_URL || "http://127.0.0.1:5181";
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
  "Use isolated loopback preview storage.",
);
const token = process.env.ADMIN_TOKEN;
assert.ok(
  token && token.length >= 32,
  "Set ADMIN_TOKEN to the isolated preview credential.",
);
const output =
  process.env.PHASM_SCREENSHOT_DIR || "test-results/nationwide-review";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  ...(process.env.HTTPS_PROXY
    ? {
        proxy: {
          server: process.env.HTTPS_PROXY,
          bypass: "localhost,127.0.0.1",
        },
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
const results = [];
const errors = [];
const networkLimits = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => {
  if (request.url().includes("tiles.openfreemap.org"))
    networkLimits.push("Basemap request failed");
});
const auth = { Authorization: `Bearer ${token}` };
async function get(path, authorized = true) {
  return context.request.get(`${base}${path}`, {
    headers: authorized ? auth : {},
  });
}
async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Horizontal viewport overflow",
  );
}
async function unlock() {
  await page.goto(`${base}/admin/review`);
  await page.getByLabel("Editorial access token").fill(token);
  await page.getByRole("button", { name: "Unlock private review" }).click();
  await expect(
    page.locator(".review-cards .location-card").first(),
  ).toBeVisible();
}
try {
  const metadata = await (await get("/api/admin/review/meta")).json();
  const total = metadata.groups.reduce((sum, group) => sum + group.total, 0);
  const drafts = metadata.groups
    .filter((group) => group.status === "draft")
    .reduce((sum, group) => sum + group.total, 0);
  assert.ok(
    drafts > 0,
    "Apply the pilot or full import to isolated preview first.",
  );
  const sample = await (
    await get("/api/admin/review/locations?status=draft&pageSize=24")
  ).json();
  const unmapped = sample.locations.find(
    (location) => location.coordinatePrecision === "withheld",
  );
  assert.ok(
    unmapped,
    "Expected an unmapped draft in representative first page.",
  );
  const draft = sample.locations[0];
  await check(
    "Private APIs require credentials and public routes exclude sampled drafts",
    async () => {
      for (const path of [
        "/api/admin/review/meta",
        "/api/admin/review/locations",
        "/api/admin/review/atlas",
        `/api/admin/review/locations/${draft.slug}`,
      ]) {
        assert.equal((await get(path, false)).status(), 401, path);
        const response = await get(path);
        assert.equal(response.status(), 200, path);
        assert.equal(response.headers()["cache-control"], "no-store", path);
      }
      for (const path of [
        `/api/locations/${draft.slug}`,
        `/api/locations/${draft.slug}?format=summary`,
        `/locations/${draft.slug}`,
      ])
        assert.equal((await get(path, false)).status(), 404, path);
      const publicMeta = await (await get("/api/meta", false)).json();
      assert.equal(
        publicMeta.total,
        total -
          drafts -
          metadata.groups
            .filter((group) => group.status === "archived")
            .reduce((sum, group) => sum + group.total, 0),
      );
      const sitemap = await (await get("/sitemap.xml", false)).text();
      assert.ok(!sitemap.includes(`/locations/${draft.slug}`));
      const publicCards = await (
        await get(
          `/api/locations?q=${encodeURIComponent(draft.name)}&status=draft&includeDrafts=true`,
          false,
        )
      ).json();
      assert.ok(
        !publicCards.locations.some((location) => location.id === draft.id),
      );
      const publicAtlas = await (
        await get("/api/atlas?zoom=5&status=draft", false)
      ).json();
      assert.ok(
        !publicAtlas.features.some(
          (feature) => feature.properties.id === draft.id,
        ),
      );
    },
  );
  await check(
    "Private catalog and map use bounded payloads and preserve unmapped records",
    async () => {
      assert.equal(sample.locations.length, Math.min(24, drafts));
      assert.equal(sample.total, drafts);
      assert.ok(
        sample.locations.every(
          (location) => !("history" in location) && !("reports" in location),
        ),
      );
      const started = performance.now();
      const response = await get("/api/admin/review/atlas?zoom=5");
      const text = await response.text();
      const atlas = JSON.parse(text);
      assert.ok(atlas.features.length <= 500);
      assert.equal(
        atlas.total,
        metadata.groups.reduce((sum, group) => sum + group.mapped, 0),
      );
      assert.ok(!text.includes('"history"') && !text.includes('"image"'));
      assert.ok(
        atlas.features.every((feature) =>
          feature.geometry.coordinates.every(Number.isFinite),
        ),
      );
      results.push({
        name: "Map response measurement",
        total,
        drafts,
        mapped: atlas.total,
        bytes: Buffer.byteLength(text),
        elapsedMs: Math.round(performance.now() - started),
        passed: true,
      });
    },
  );
  await check("Full-catalog API latency and payload measurements", async () => {
    const measurements = [];
    for (const path of [
      "/api/admin/review/locations?status=draft&pageSize=24",
      "/api/admin/review/locations?status=draft&pageSize=24&page=50",
      "/api/admin/review/locations?status=draft&state=Colorado&q=Hotel&pageSize=24",
      "/api/admin/review/atlas?zoom=5",
      "/api/atlas?zoom=5",
    ]) {
      const samples = [];
      let bytes = 0;
      for (let iteration = 0; iteration < 10; iteration++) {
        const start = performance.now();
        const response = await get(path, path.includes("/admin/"));
        assert.equal(response.status(), 200);
        const body = await response.body();
        bytes = body.length;
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      measurements.push({
        path,
        samples: samples.length,
        bytes,
        medianMs: Number(samples[5].toFixed(2)),
        p95Ms: Number(samples[9].toFixed(2)),
      });
    }
    await writeFile(
      `${output}/review-api-performance.json`,
      JSON.stringify(
        {
          base,
          environment:
            "Local loopback preview; ten sequential reads per endpoint, not a production or mobile-device benchmark.",
          total,
          drafts,
          measurements,
        },
        null,
        2,
      ),
    );
  });
  await check(
    "Desktop review supports rendered cards, state filters, pagination, and empty search",
    async () => {
      await unlock();
      await noOverflow();
      await expect(page.locator(".review-cards .location-card")).toHaveCount(
        Math.min(24, drafts),
      );
      await page.screenshot({
        path: `${output}/review-desktop-list.png`,
        fullPage: false,
      });
      if (drafts > 24) {
        const first = await page
          .locator(".review-card-title")
          .first()
          .innerText();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(page.locator(".pagination")).toContainText("Page 2");
        await expect(page.locator(".review-card-title").first()).not.toHaveText(
          first,
        );
        await page
          .getByRole("button", { name: "Previous", exact: true })
          .click();
      }
      await page.getByLabel("State", { exact: true }).selectOption(draft.state);
      await expect(
        page.locator(".review-cards .location-card").first(),
      ).toContainText(draft.state);
      await page
        .getByLabel("Search research", { exact: true })
        .fill("phasmnonexistentzzzz");
      await page
        .getByRole("button", { name: "Search research", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "No research profiles match." }),
      ).toBeVisible();
      await page.getByLabel("State", { exact: true }).selectOption("");
      await page.getByLabel("Search research", { exact: true }).fill("");
      await page
        .getByRole("button", { name: "Search research", exact: true })
        .click();
      await expect(
        page.locator(".review-cards .location-card").first(),
      ).toBeVisible();
    },
  );
  await check(
    "Unmapped detail has attribution, an honest placeholder, and no directions",
    async () => {
      await page
        .getByRole("button", { name: unmapped.name, exact: true })
        .click();
      const detail = page.getByRole("region", {
        name: "Selected research profile",
      });
      await expect(
        detail.getByRole("heading", { name: unmapped.name, exact: true }),
      ).toBeVisible();
      await expect(detail).toContainText("Location not mapped");
      await expect(
        detail.getByRole("link", { name: /Directions/ }),
      ).toHaveCount(0);
      await expect(
        detail.getByRole("heading", { name: "Sources and attribution" }),
      ).toBeVisible();
      const img = detail.locator("img");
      await expect
        .poll(() =>
          img.evaluate((image) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      if (unmapped.image.includes("placeholder"))
        await expect(detail).toContainText("does not depict the location");
      await noOverflow();
      await page.screenshot({
        path: `${output}/review-desktop-detail.png`,
        fullPage: false,
      });
      await page
        .getByRole("button", { name: "Close profile", exact: true })
        .click();
    },
  );
  await check(
    "Review map authenticates its lightweight feed and public records remain available",
    async () => {
      await page.getByLabel("Publication status").selectOption("published");
      await expect(
        page.locator(".review-cards .location-card").first(),
      ).toBeVisible();
      const mapResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/admin/review/atlas" &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "Show review map" }).click();
      await mapResponse;
      await expect(page.locator(".review-map .map-status")).toContainText(
        /mapped|No mapped/,
      );
      assert.ok(!page.url().includes(token));
      await page.screenshot({
        path: `${output}/review-desktop-map.png`,
        fullPage: false,
      });
      await page.getByRole("button", { name: "Hide review map" }).click();
      await page.getByLabel("Publication status").selectOption("draft");
    },
  );
  await check(
    "Mobile detail, controls, image fallback, and accessibility work",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.locator(".review-cards .location-card").first(),
      ).toBeVisible();
      await noOverflow();
      await page.screenshot({
        path: `${output}/review-mobile-list.png`,
        fullPage: false,
      });
      await page
        .getByRole("button", { name: unmapped.name, exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Selected research profile" }),
      ).toContainText("Location not mapped");
      await noOverflow();
      await page.screenshot({
        path: `${output}/review-mobile-detail.png`,
        fullPage: false,
      });
      const scan = await new AxeBuilder({ page })
        .include(".review-workspace")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      assert.deepEqual(
        scan.violations.map(({ id, impact }) => ({ id, impact })),
        [],
      );
      const image = page.locator(".review-detail img");
      await image.evaluate((element) => {
        element.removeAttribute("srcset");
        element.src = "/images/review-test-missing.jpg";
      });
      await expect(image).toHaveAttribute("alt", /Generic illustration/);
      await expect
        .poll(() =>
          image.evaluate(
            (element) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
    },
  );
  const photoCandidates = await (
    await get("/api/admin/review/locations?q=Hotel%20Jerome&pageSize=50")
  ).json();
  const photo = photoCandidates.locations.find((location) =>
    location.image.startsWith("/images/research/"),
  );
  if (photo)
    await check(
      "Cleared Hotel Jerome photograph decodes with matching attribution and versioned license link",
      async () => {
        await page
          .getByRole("button", { name: "Close profile", exact: true })
          .click();
        await page.getByLabel("Publication status").selectOption("");
        await page
          .getByLabel("Search research", { exact: true })
          .fill("Hotel Jerome");
        await page
          .getByRole("button", { name: "Search research", exact: true })
          .click();
        await page
          .getByRole("button", { name: photo.name, exact: true })
          .click();
        const detail = page.getByRole("region", {
          name: "Selected research profile",
        });
        const full = await (
          await get(`/api/admin/review/locations/${photo.slug}`)
        ).json();
        await expect(detail.locator("img")).toHaveAttribute("src", photo.image);
        await expect
          .poll(() =>
            detail
              .locator("img")
              .evaluate((image) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true);
        await detail.locator("img").evaluate(async (image) => {
          await image.decode();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
        await expect(detail.locator("figcaption")).toContainText(
          full.location.imageCredit,
        );
        await expect(
          detail.getByRole("link", { name: "Image source", exact: true }),
        ).toHaveAttribute("href", full.location.imageSource);
        const cc = /^CC (BY(?:-SA)?) (\d\.\d)$/.exec(
          full.location.imageLicense,
        );
        if (cc)
          await expect(
            detail.getByRole("link", {
              name: full.location.imageLicense,
              exact: true,
            }),
          ).toHaveAttribute(
            "href",
            `https://creativecommons.org/licenses/${cc[1].toLowerCase()}/${cc[2]}/`,
          );
        await noOverflow();
        await page.screenshot({
          path: `${output}/review-mobile-cleared-photo.png`,
          fullPage: false,
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await detail.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${output}/review-desktop-cleared-photo.png`,
          fullPage: false,
        });
      },
    );
  const panoramaCandidates = await (
    await get("/api/admin/review/locations?q=Belvoir%20Winery&pageSize=50")
  ).json();
  const panorama = panoramaCandidates.locations.find((location) =>
    location.image.startsWith("/images/research/"),
  );
  if (panorama)
    await check(
      "Belvoir panorama remains whole in the card and detail view",
      async () => {
        if (
          await page
            .getByRole("button", { name: "Close profile", exact: true })
            .count()
        )
          await page
            .getByRole("button", { name: "Close profile", exact: true })
            .click();
        await page.getByLabel("Publication status").selectOption("");
        await page
          .getByLabel("Search research", { exact: true })
          .fill("Belvoir Winery");
        await page
          .getByRole("button", { name: "Search research", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: panorama.name, exact: true }),
        ).toBeVisible();
        const cardImage = page.locator(".review-cards img").first();
        await cardImage.scrollIntoViewIfNeeded();
        await cardImage.evaluate(async (image) => {
          await image.decode();
        });
        assert.ok(
          await cardImage.evaluate(
            (image) => image.naturalWidth / image.naturalHeight >= 3,
          ),
        );
        await expect(cardImage).toHaveCSS("object-fit", "contain");
        await page
          .getByRole("button", { name: panorama.name, exact: true })
          .click();
        const detail = page.getByRole("region", {
          name: "Selected research profile",
        });
        await expect(detail.locator("img")).toHaveAttribute(
          "src",
          panorama.image,
        );
        await detail.locator("img").evaluate(async (image) => {
          await image.decode();
        });
        await expect(detail.locator("img")).toHaveCSS("object-fit", "contain");
        await page.screenshot({
          path: `${output}/review-panorama.png`,
          fullPage: false,
        });
      },
    );
  const privateLocations = await (
    await get("/api/admin/review/locations?access=private&pageSize=50")
  ).json();
  for (const [label, selectedPrivate] of [
    [
      "approximate",
      privateLocations.locations.find(
        (location) => location.coordinatePrecision === "approximate",
      ),
    ],
    [
      "unmapped",
      privateLocations.locations.find(
        (location) => location.coordinatePrecision === "withheld",
      ),
    ],
  ]) {
    if (!selectedPrivate) continue;
    await check(
      `Private ${label} location retains access caution and has no precise directions`,
      async () => {
        if (
          await page
            .getByRole("button", { name: "Close profile", exact: true })
            .count()
        )
          await page
            .getByRole("button", { name: "Close profile", exact: true })
            .click();
        await page.getByLabel("Publication status").selectOption("");
        await page
          .getByLabel("State", { exact: true })
          .selectOption(selectedPrivate.state);
        await page
          .getByLabel("Search research", { exact: true })
          .fill(selectedPrivate.name);
        await page
          .getByRole("button", { name: "Search research", exact: true })
          .click();
        await page
          .getByRole("button", { name: selectedPrivate.name, exact: true })
          .click();
        const detail = page.getByRole("region", {
          name: "Selected research profile",
        });
        await expect(detail).toContainText("Access: private");
        await expect(detail).toContainText(
          label === "approximate"
            ? "Approximate location"
            : "Location not mapped",
        );
        await expect(
          detail.getByRole("link", { name: /Directions/ }),
        ).toHaveCount(0);
        await noOverflow();
        results.push({
          name: `Private ${label} sample`,
          locationId: selectedPrivate.id,
          passed: true,
        });
      },
    );
  }
  await check(
    "Lock and reload discard credentials and loaded drafts",
    async () => {
      assert.deepEqual(
        await page.evaluate(() => ({
          local: Object.keys(localStorage),
          session: Object.keys(sessionStorage),
        })),
        { local: [], session: [] },
      );
      await page.getByRole("button", { name: "Lock workspace" }).click();
      await expect(page.getByLabel("Editorial access token")).toHaveValue("");
      await expect(
        page.locator(".review-cards,.review-detail,.review-map"),
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Unlock private review" }),
      ).toBeVisible();
      assert.deepEqual(errors, []);
    },
  );
} catch (error) {
  results.push({
    name: "Browser verification",
    passed: false,
    error: error.message.replaceAll(token, "[redacted]"),
  });
  process.exitCode = 1;
} finally {
  await writeFile(
    `${output}/review-browser-results.json`,
    JSON.stringify(
      {
        base,
        results,
        networkLimits: [...new Set(networkLimits)],
        runtimeErrors: errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
