/** End-to-end smoke checks against a running `npm run dev` instance.
 * Run: node tests/browser.mjs
 * Set PHASM_BASE_URL and PHASM_SCREENSHOT_DIR to override defaults.
 * Browser network traffic keeps the managed environment's outbound proxy.
 */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.PHASM_BASE_URL || "http://localhost:5173";
const output = process.env.PHASM_SCREENSHOT_DIR || "/workspace/scratch";
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
const results = [];
const errors = [];
const mapResponses = [];
const a11yResults = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().includes("tiles.openfreemap.org"))
    mapResponses.push({ status: response.status(), url: response.url() });
});
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function noOverflow(target) {
  const sizes = await target.evaluate(() => ({
    inner: innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    sizes.body <= sizes.inner + 1 && sizes.document <= sizes.inner + 1,
    JSON.stringify(sizes),
  );
}

async function auditAccessibility(label) {
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  a11yResults.push({ label, violations: scan.violations });
  assert.deepEqual(
    scan.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
}

try {
  await check(
    "Desktop homepage, live cards, images and keyboard skip link",
    async () => {
      await page.goto(baseURL, { waitUntil: "networkidle" });
      await expect(
        page.getByRole("heading", { name: /Some places/ }),
      ).toBeVisible();
      await expect(page.locator(".location-card")).toHaveCount(3);
      assert.ok(
        await page
          .locator(".hero-image")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      );
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await noOverflow(page);
      await page.mouse.click(1400, 900);
      await page.screenshot({
        path: `${output}/phasm-desktop.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "Homepage location search navigates and filters real records",
    async () => {
      await page
        .getByRole("textbox", { name: "Search for haunted places or a region" })
        .fill("Stanley");
      await page.getByRole("button", { name: "Find haunted places" }).click();
      await expect(page).toHaveURL(/\/map\?q=Stanley/);
      await expect(page.locator(".results-heading")).toContainText(
        "1 places to discover",
      );
      await expect(page.locator(".atlas-card-list .card-title")).toHaveText(
        "The Stanley Hotel",
      );
    },
  );
  await check(
    "MapLibre real external style and vector tiles load",
    async () => {
      await page.goto(`${baseURL}/map`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".map-status")).toContainText(
        /places in this area/,
        { timeout: 60000 },
      );
      await expect(page.locator(".maplibregl-canvas")).toBeVisible();
      const canvasBounds = await page
        .locator(".maplibregl-canvas")
        .boundingBox();
      assert.ok(
        canvasBounds && canvasBounds.width > 300 && canvasBounds.height > 300,
        `Map canvas too small: ${JSON.stringify(canvasBounds)}`,
      );
      assert.ok(
        mapResponses.some(
          (r) => r.status === 200 && /\/styles\/dark$/.test(r.url),
        ),
        "No successful style response",
      );
      assert.ok(
        mapResponses.some(
          (r) => r.status === 200 && /\/planet\/.+\.pbf$/.test(r.url),
        ),
        "No successful vector tile response",
      );
      assert.equal(await page.locator(".map-fallback").count(), 0);
      await noOverflow(page);
      await page.screenshot({ path: `${output}/phasm-map.png` });
    },
  );
  await check(
    "Region, category, tours and empty search filters work",
    async () => {
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Region", exact: true })
        .selectOption("Europe");
      await expect(
        page.locator(".atlas-card-list .location-card"),
      ).not.toHaveCount(0);
      await expect(page.locator(".atlas-card-list")).not.toContainText(
        "The Stanley Hotel",
      );
      await page
        .getByRole("combobox", { name: "Category", exact: true })
        .selectOption("Castle");
      await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(2);
      assert.deepEqual(
        (
          await page.locator(".atlas-card-list .card-title").allTextContents()
        ).sort(),
        ["Bran Castle", "Edinburgh Castle"],
      );
      await page
        .getByRole("combobox", { name: "Tours", exact: true })
        .selectOption("yes");
      await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(2);
      await page.getByRole("button", { name: "Reset all" }).click();
      await expect(page).toHaveURL(/\/map$/);
      await expect(
        page.getByRole("textbox", {
          name: "Search location name, city, state or country",
        }),
      ).toHaveValue("");
      await page
        .getByRole("textbox", {
          name: "Search location name, city, state or country",
        })
        .fill("nonexistent phasm location xyz");
      await page.getByRole("button", { name: "Search atlas" }).click();
      await expect(page).toHaveURL(/q=nonexistent/);
      await expect(
        page.getByRole("heading", { name: "A quieter corner of the atlas." }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Clear search & filters" })
        .click();
      await expect(
        page.locator(".atlas-card-list .location-card"),
      ).not.toHaveCount(0);
    },
  );
  await check(
    "List view, Stanley profile, sources and device-local saves",
    async () => {
      await page.locator(".view-switch button").nth(1).click();
      await expect(page.locator(".atlas-body")).toHaveClass(/list-only/);
      await page
        .locator(".card-title")
        .filter({ hasText: "The Stanley Hotel" })
        .click();
      await expect(
        page.getByRole("heading", { name: "The Stanley Hotel", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Before the stories." }),
      ).toBeVisible();
      await expect(page.locator("#sources .source-list li")).not.toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Official visitor information" }),
      ).toHaveAttribute("href", /^https:\/\//);
      await expect(
        page.getByText("Submissions are not open yet"),
      ).toBeVisible();
      await noOverflow(page);
      await page
        .getByRole("button", { name: "Save place", exact: true })
        .first()
        .click();
      await page.goto(`${baseURL}/saved`);
      await expect(page.locator(".card-title")).toHaveText("The Stanley Hotel");
      await page.reload();
      await expect(page.locator(".card-title")).toHaveText("The Stanley Hotel");
      await page.getByRole("button", { name: "Remove saved place" }).click();
      await expect(
        page.getByRole("heading", { name: "Let curiosity lead you." }),
      ).toBeVisible();
    },
  );
  await check(
    "Map marker preview, zoom and map-to-profile navigation",
    async () => {
      await page.goto(`${baseURL}/map?q=Stanley`);
      await expect(page.locator(".map-status")).toHaveText(
        /1 place in this area/,
        { timeout: 60000 },
      );
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect(page.locator(".map-status")).toHaveText(
        /1 place in this area/,
        { timeout: 30000 },
      );
      const bounds = await page.locator(".maplibregl-canvas").boundingBox();
      assert.ok(bounds);
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await expect(page.locator(".map-preview h2")).toHaveText(
        "The Stanley Hotel",
      );
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${output}/phasm-map-preview.png` });
      await page.getByRole("link", { name: "Explore this place" }).click();
      await expect(page).toHaveURL(/\/locations\/stanley-hotel$/);
      await expect(
        page.getByRole("heading", {
          name: "The Stanley Hotel",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
    },
  );
  await check(
    "Admin stays locked without a configured valid credential",
    async () => {
      await page.goto(`${baseURL}/admin`);
      await expect(page.getByLabel("Editorial access token")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "New location" }),
      ).toHaveCount(0);
      await page
        .getByLabel("Editorial access token")
        .fill("invalid-credential-000000000000000000000000");
      await page.getByRole("button", { name: "Unlock editorial desk" }).click();
      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(
        page.getByRole("button", { name: "New location" }),
      ).toHaveCount(0);
    },
  );
  await check(
    "Mobile 390px home, navigation, map, list and profile fit viewport",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(baseURL, { waitUntil: "networkidle" });
      await noOverflow(page);
      await page.screenshot({
        path: `${output}/phasm-mobile.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Haunted Atlas" })
        .click();
      await expect(page).toHaveURL(/\/map$/);
      await expect(page.locator(".maplibregl-canvas")).toBeVisible();
      await noOverflow(page);
      await expect(page.locator(".map-status")).toHaveText(
        /places in this area|No published places/,
        { timeout: 60000 },
      );
      await page.screenshot({ path: `${output}/phasm-map-mobile.png` });
      await page.locator(".view-switch button").nth(1).click();
      await expect(
        page.locator(".atlas-card-list .card-title").first(),
      ).toBeVisible();
      await noOverflow(page);
      await page
        .locator(".card-title")
        .filter({ hasText: "The Stanley Hotel" })
        .click();
      await expect(
        page.getByRole("heading", { name: "The Stanley Hotel", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await expect(page.locator(".profile-intro")).toBeVisible();
      await page.screenshot({
        path: `${output}/phasm-profile-mobile.png`,
        fullPage: true,
      });
    },
  );
  for (const [label, route, width] of [
    ["desktop home", "/", 1440],
    ["desktop map", "/map", 1440],
    ["desktop list", "/map", 1440],
    ["desktop profile", "/locations/stanley-hotel", 1440],
    ["admin login", "/admin", 1440],
    ["mobile home", "/", 390],
    ["mobile profile", "/locations/stanley-hotel", 390],
  ]) {
    await check(`${label} automated WCAG A/AA scan`, async () => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });
      if (label === "desktop list")
        await page.getByRole("button", { name: "List view" }).click();
      await auditAccessibility(label);
    });
  }
  await check("No uncaught application errors", async () =>
    assert.deepEqual(errors, []),
  );
} finally {
  await browser.close();
  await writeFile(
    `${output}/phasm-qa-results.json`,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        baseURL,
        results,
        mapResponses,
        errors,
        a11yResults,
      },
      null,
      2,
    ),
  );
}
console.log(
  `${results.filter((r) => r.passed).length}/${results.length} browser checks passed. Screenshots: ${output}`,
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
