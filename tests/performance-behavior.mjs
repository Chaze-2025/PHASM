/** Deterministic, read-only checks for the performance contracts. No app writes. */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const base = process.env.PHASM_BASE_URL || "http://localhost:5173";
const output =
  process.env.PHASM_PERF_OUTPUT ||
  "/workspace/phasm-performance/local-behavior";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
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
const results = [],
  errors = [],
  requests = [],
  feeds = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
async function attach(context) {
  await context.addInitScript(() => {
    window.__webglRequests = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (String(kind).includes("webgl")) window.__webglRequests++;
      return original.call(this, kind, ...args);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  page.on("response", async (r) => {
    if (new URL(r.url()).pathname === "/api/atlas" && r.status() === 200) {
      try {
        feeds.push({ url: r.url(), data: await r.json() });
      } catch {}
    }
  });
  return page;
}
const atlasRequests = (start) =>
  requests.slice(start).filter((r) => new URL(r.url).pathname === "/api/atlas");
async function ready(page) {
  await expect(page.locator(".map-status")).toContainText(
    /mapped places? in this area|No mapped places in this area/,
    { timeout: 60000 },
  );
  await page.waitForTimeout(600);
}
async function home(page) {
  await expect(page.locator(".location-card")).toHaveCount(3);
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await attach(context);
  await check(
    "Initial list view avoids map code, map requests and WebGL",
    async () => {
      await page.goto(base + "/map?view=list", { waitUntil: "networkidle" });
      await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(
        24,
      );
      assert.equal(await page.evaluate(() => window.__webglRequests), 0);
      assert.equal(await page.locator(".maplibregl-canvas").count(), 0);
      assert.equal(atlasRequests(0).length, 0);
      const mapCode = requests.filter((r) =>
        /MapCanvas|maplibre|maplibre-gl-worker/i.test(r.url),
      );
      assert.deepEqual(mapCode, []);
      return { requests: requests.length, mapCode: 0, webgl: 0 };
    },
  );
  await check(
    "Map initializes with one complete feed containing all 136 numeric pins",
    async () => {
      const start = requests.length;
      await page.getByRole("button", { name: "Map view", exact: true }).click();
      await ready(page);
      assert.equal(atlasRequests(start).length, 1);
      const data = feeds.at(-1).data;
      assert.equal(data.total, 136);
      assert.equal(data.features.length, 136);
      assert.ok(
        data.features.every(
          (f) =>
            !f.properties.clustered &&
            f.geometry.coordinates.every(Number.isFinite),
        ),
      );
      return {
        requests: atlasRequests(start).length,
        total: data.total,
        points: data.features.length,
      };
    },
  );
  await check("Pan and zoom reuse pins without atlas requests", async () => {
    const start = requests.length,
      r = await page.locator(".maplibregl-canvas").boundingBox();
    await page.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.55, r.y + r.height * 0.55, {
      steps: 10,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(800);
    assert.equal(atlasRequests(start).length, 0);
    return { atlasRequests: 0 };
  });
  await check(
    "Filtered pagination preserves the map viewport and makes no atlas request",
    async () => {
      await page.locator(".filter-toggle").click();
      await page
        .getByRole("combobox", { name: "Region", exact: true })
        .selectOption("North America");
      await page
        .getByRole("button", { name: "Close filters", exact: true })
        .click();
      await ready(page);
      await page.waitForLoadState("networkidle");
      const before = await page.locator(".maplibregl-canvas").screenshot(),
        start = requests.length;
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.locator(".pagination")).toContainText("Page 2 of");
      await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(
        24,
      );
      await page.waitForTimeout(700);
      assert.equal(atlasRequests(start).length, 0);
      const after = await page.locator(".maplibregl-canvas").screenshot();
      const a = await sharp(before).raw().toBuffer(),
        b = await sharp(after).raw().toBuffer();
      assert.equal(a.length, b.length);
      let changed = 0;
      for (let i = 0; i < a.length; i++)
        if (Math.abs(a[i] - b[i]) > 2) changed++;
      assert.ok(
        changed / a.length < 0.001,
        `Map changed on pagination (${changed}/${a.length} channels)`,
      );
      return { atlasRequests: 0, changedChannelFraction: changed / a.length };
    },
  );
  await check(
    "One filtered feed includes all matching pins across every page",
    async () => {
      await page.locator(".filter-toggle").click();
      const start = requests.length;
      await page
        .getByRole("combobox", { name: "Region", exact: true })
        .selectOption("Europe");
      await page
        .getByRole("button", { name: "Close filters", exact: true })
        .click();
      await ready(page);
      const data = feeds.at(-1).data;
      const expected = await page.request
        .get(base + "/api/locations?region=Europe&pageSize=1&format=summary")
        .then((r) => r.json());
      assert.equal(data.total, expected.total);
      assert.equal(data.features.length, expected.total);
      assert.equal(atlasRequests(start).length, 1);
      return { requests: 1, total: data.total, points: data.features.length };
    },
  );
  await check(
    "Repeated marker selection reuses its cached compact preview",
    async () => {
      await page.locator(".filter-toggle").click();
      await page
        .getByRole("button", { name: "Reset all", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Close filters", exact: true })
        .click();
      await page
        .getByRole("textbox", {
          name: "Search location name, city, state or country",
        })
        .fill("Stanley");
      await page
        .getByRole("button", { name: "Search atlas", exact: true })
        .click();
      await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(1);
      await ready(page);
      const r = await page.locator(".maplibregl-canvas").boundingBox();
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      await expect(page.locator(".map-preview h2")).toHaveText(
        "The Stanley Hotel",
      );
      await page
        .getByRole("button", { name: "Close location preview", exact: true })
        .click();
      const start = requests.length;
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      await expect(page.locator(".map-preview h2")).toHaveText(
        "The Stanley Hotel",
      );
      await page.waitForTimeout(250);
      const repeats = requests
        .slice(start)
        .filter(
          (r) => new URL(r.url).pathname === "/api/locations/stanley-hotel",
        );
      assert.equal(repeats.length, 0);
      return { repeatedDetailRequests: 0 };
    },
  );
  await check(
    "Warm homepage navigation reuses data without new API requests",
    async () => {
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await nav.getByRole("link", { name: "Discover", exact: true }).click();
      await home(page);
      await nav
        .getByRole("link", { name: "Haunted Atlas", exact: true })
        .click();
      await ready(page);
      const start = requests.length;
      await nav.getByRole("link", { name: "Discover", exact: true }).click();
      await home(page);
      await page.waitForTimeout(350);
      assert.equal(
        requests
          .slice(start)
          .filter((r) => new URL(r.url).pathname.startsWith("/api/")).length,
        0,
      );
      return { repeatedAPIRequests: 0 };
    },
  );
  await context.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const phone = await attach(mobile);
  await check(
    "DPR3 mobile map renders at no more than DPR2 with every pin retained",
    async () => {
      await phone.goto(base + "/map", { waitUntil: "domcontentloaded" });
      await ready(phone);
      const size = await phone
        .locator(".maplibregl-canvas")
        .evaluate((c) => ({
          width: c.width,
          height: c.height,
          cssWidth: c.clientWidth,
          cssHeight: c.clientHeight,
          devicePixelRatio,
        }));
      assert.equal(size.devicePixelRatio, 3);
      assert.ok(size.width <= size.cssWidth * 2 + 1);
      assert.ok(size.height <= size.cssHeight * 2 + 1);
      assert.equal(feeds.at(-1).data.features.length, 136);
      return size;
    },
  );
  await mobile.close();
  await check(
    "No uncaught application errors or mutating requests",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(
        requests.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method)),
        [],
      );
    },
  );
} finally {
  await browser.close();
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { base, checkedAt: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  );
  console.log(
    `${results.filter((r) => r.passed).length}/${results.length} performance behavior checks passed`,
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
