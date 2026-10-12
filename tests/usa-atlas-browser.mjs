import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const base = process.env.PHASM_BASE_URL || "http://localhost:5173";
const output =
  process.env.PHASM_SCREENSHOT_DIR || "/workspace/phasm-verification";
const catalog = JSON.parse(await readFile("content/locations.json", "utf8"));
const approximatePrivate = catalog.find((p) => p.id.includes("woodburn"));
const storyOnly = catalog.find((p) => !p.history);
assert.ok(
  approximatePrivate && storyOnly,
  "Expected representative research profiles",
);
assert.equal(approximatePrivate.coordinatePrecision, "approximate");
assert.equal(approximatePrivate.access, "private");
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
  reducedMotion: "reduce",
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const results = [];
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
  );
}
try {
  await check(
    "Complete paginated catalog has 136 unique profiles, 130 US records, and 50 states",
    async () => {
      const all = [];
      for (let n = 1; n <= 3; n++) {
        const response = await context.request.get(
          `${base}/api/locations?pageSize=50&page=${n}`,
        );
        assert.ok(response.ok());
        const body = await response.json();
        assert.equal(body.total, 136);
        all.push(...body.locations);
      }
      assert.equal(new Set(all.map((p) => p.id)).size, 136);
      const us = all.filter((p) => p.country === "United States");
      assert.equal(us.length, 130);
      assert.equal(new Set(us.map((p) => p.state)).size, 50);
      assert.equal(
        all.filter((p) => p.coordinatePrecision === "withheld").length,
        0,
      );
      for (const location of all) {
        assert.ok(Number.isFinite(location.latitude));
        assert.ok(Number.isFinite(location.longitude));
        assert.ok(Math.abs(location.latitude) <= 90);
        assert.ok(Math.abs(location.longitude) <= 180);
      }
    },
  );
  await check(
    "Atlas returns all 136 profiles as sourced numeric map points",
    async () => {
      const response = await context.request.get(`${base}/api/atlas?zoom=10`);
      assert.ok(response.ok());
      const body = await response.json();
      assert.equal(body.total, 136);
      assert.equal(body.features.length, 136);
      assert.deepEqual(
        body.features.map((feature) => feature.properties.id).sort(),
        catalog.map((location) => location.id).sort(),
      );
      const locationsById = new Map(catalog.map((p) => [p.id, p]));
      for (const feature of body.features) {
        const location = locationsById.get(feature.properties.id);
        assert.equal(feature.geometry.type, "Point");
        assert.ok(feature.geometry.coordinates.every(Number.isFinite));
        assert.deepEqual(feature.geometry.coordinates, [
          location.longitude,
          location.latitude,
        ]);
      }
      const woodburnPoint = body.features.find(
        (feature) => feature.properties.id === approximatePrivate.id,
      );
      assert.ok(woodburnPoint, "Woodburn must have a public map marker");
    },
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await check(
      `Approximate private profile has a map pin without directions (${width}px)`,
      async () => {
        await page.goto(`${base}/locations/${approximatePrivate.slug}`, {
          waitUntil: "networkidle",
        });
        await expect(
          page.getByRole("heading", {
            name: approximatePrivate.name,
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.locator(".profile-location-note")).toContainText(
          "Approximate location",
        );
        await expect(
          page.getByRole("link", { name: "View on the atlas", exact: true }),
        ).toHaveAttribute(
          "href",
          `/map?q=${encodeURIComponent(approximatePrivate.name)}`,
        );
        assert.equal(await page.locator(".visit-map-note").count(), 0);
        assert.equal(
          await page.getByRole("link", { name: /directions/i }).count(),
          0,
        );
        const metadata = await page
          .locator('script[type="application/ld+json"]')
          .textContent();
        assert.ok(!JSON.parse(metadata).geo);
        await expect(page.locator("#reports")).toContainText(
          approximatePrivate.reports,
        );
        await noOverflow();
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          scan.violations.map((v) => ({ id: v.id, impact: v.impact })),
          [],
        );
        await page.screenshot({
          path: `${output}/approximate-private-${width}.png`,
          fullPage: true,
        });
        await page.goto(
          `${base}/map?q=${encodeURIComponent(approximatePrivate.name)}&view=list`,
          { waitUntil: "networkidle" },
        );
        await expect(page.locator(".results-heading")).toContainText(
          "1 profile to discover",
        );
        await expect(page.locator(".card-title")).toHaveText(
          approximatePrivate.name,
        );
        assert.equal(await page.locator(".card-map-note").count(), 0);
        await expect(page.locator(".atlas-body")).toHaveClass(/list-only/);
        await noOverflow();
      },
    );
    await check(
      `Story-only profile preserves its sourced narrative and illustration (${width}px)`,
      async () => {
        await page.goto(`${base}/locations/${storyOnly.slug}`, {
          waitUntil: "networkidle",
        });
        await expect(
          page.getByRole("heading", { name: storyOnly.name, exact: true }),
        ).toBeVisible();
        assert.equal(await page.locator("#history").count(), 0);
        assert.equal(await page.locator('a[href="#history"]').count(), 0);
        await expect(page.locator("#reports")).toContainText(storyOnly.reports);
        await expect(page.locator("#gallery")).toContainText(/illustration/i);
        assert.ok(
          await page
            .locator(".profile-hero img")
            .first()
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        );
        await noOverflow();
        await page.screenshot({
          path: `${output}/story-only-${width}.png`,
          fullPage: true,
        });
      },
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${output}/usa-atlas-browser.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
