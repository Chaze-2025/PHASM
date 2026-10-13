/** Read-only UI regression using intercepted reference-pin fixtures.
 * Run against a local dev server: PHASM_BASE_URL=http://localhost:5173 node tests/reference-pins-browser.mjs
 */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const base = process.env.PHASM_BASE_URL || "http://localhost:5173";
const output =
  process.env.PHASM_SCREENSHOT_DIR || "/workspace/phasm-reference-pins-ui";
await mkdir(output, { recursive: true });
const original = JSON.parse(
  await readFile("content/locations.json", "utf8"),
)[0];
const locations = ["A", "B"].map((letter) => ({
  ...original,
  id: `reference-${letter.toLowerCase()}`,
  slug: `reference-${letter.toLowerCase()}`,
  name: `Reference ${letter} Hotel`,
  latitude: 40.38,
  longitude: -105.52,
  coordinatePrecision: "approximate",
  coordinateReference: {
    scope: "locality",
    label: "Estes Park, Colorado",
    sourceUrl: "https://www.geonames.org/5576882/estes-park.html",
  },
  image: "/images/location-placeholder.svg",
  imageLicense: "PHASM original illustration",
}));
const geojson = {
  type: "FeatureCollection",
  total: 2,
  truncated: false,
  features: locations.map((location) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [location.longitude, location.latitude],
    },
    properties: {
      id: location.id,
      slug: location.slug,
      name: location.name,
      category: location.category,
      count: 1,
      clustered: false,
    },
  })),
};
const nationwidePoints = {
  ...geojson,
  total: 2859,
  features: Array.from({ length: 2859 }, (_, index) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [-124 + (index % 120) / 3, 25 + Math.floor(index / 120)],
    },
    properties: {
      id: `nationwide-${index}`,
      slug: `nationwide-${index}`,
      name: `Nationwide place ${index}`,
      category: "Hotel",
      count: 1,
      clustered: false,
    },
  })),
};
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
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    const apiRequests = [];
    let nationwide = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      assert.equal(
        request.method(),
        "GET",
        "UI checks never write to the catalog",
      );
      const url = new URL(request.url());
      apiRequests.push(url.pathname);
      let body;
      if (url.pathname === "/api/atlas")
        body = nationwide ? nationwidePoints : geojson;
      else if (url.pathname === "/api/meta")
        body = {
          total: 2,
          mapped: 2,
          categories: ["Hotel"],
          phenomena: [],
          regions: ["North America"],
        };
      else if (url.pathname === "/api/locations")
        body = { locations, total: 2, page: 1, pageSize: 24 };
      else {
        const location = locations.find((item) =>
          url.pathname.endsWith(`/${item.slug}`),
        );
        body = { location, nearby: [] };
      }
      await route.fulfill({ json: body });
    });
    // An empty basemap keeps this regression independent of map tile coverage.
    await page.route("https://tiles.openfreemap.org/styles/dark", (route) =>
      route.fulfill({
        json: {
          version: 8,
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#101312" },
            },
          ],
        },
      }),
    );
    await page.goto(`${base}/map?q=Reference`);
    await expect(page.locator(".map-status")).toContainText("2 mapped places", {
      timeout: 60000,
    });
    await page.waitForTimeout(600);
    const canvas = page.locator(".maplibregl-canvas");
    // Coincident pins stay clustered through zoom 12, then both receive clicks.
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(350);
    }
    const box = await canvas.boundingBox();
    assert.ok(box);
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    const chooser = page.getByRole("dialog", {
      name: "Choose a place on the map",
    });
    await expect(chooser).toBeVisible();
    await expect(
      chooser.getByRole("button", { name: /Reference A Hotel/ }),
    ).toBeVisible();
    await expect(
      chooser.getByRole("button", { name: /Reference B Hotel/ }),
    ).toBeVisible();
    await expect(
      chooser.getByRole("button", { name: "Close overlapping places" }),
    ).toBeFocused();
    await page.screenshot({ path: `${output}/overlapping-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(chooser).toHaveCount(0);
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await chooser.getByRole("button", { name: /Reference B Hotel/ }).click();
    await expect(page.locator(".map-preview h2")).toHaveText(
      "Reference B Hotel",
    );
    await expect(page.locator(".map-reference-label")).toContainText(
      "Town/area reference: Estes Park, Colorado",
    );
    await expect(page.locator(".map-reference-label")).toContainText(
      "Exact site position unverified",
    );
    await page.screenshot({ path: `${output}/reference-preview-${width}.png` });
    await page.getByRole("link", { name: "Explore this place" }).click();
    await expect(page).toHaveURL(`${base}/locations/reference-b`);
    await expect(
      page.getByRole("heading", {
        name: "Reference B Hotel",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.locator(".visit-map-note")).toContainText(
      "not the site's exact position",
    );
    await expect(
      page.getByRole("link", { name: "GeoNames", exact: true }),
    ).toHaveAttribute("href", locations[1].coordinateReference.sourceUrl);
    await expect(
      page.getByRole("link", { name: "CC BY 4.0", exact: true }),
    ).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    await expect(
      page.getByRole("link", { name: "Get directions" }),
    ).toHaveCount(0);
    assert.equal(
      apiRequests.filter((path) => path === "/api/atlas").length,
      1,
      "complete map feeds survive zooming without repeated requests",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS reference labels, licensed attribution, overlapping marker selection and keyboard dismissal at ${width}px`,
    );
    nationwide = true;
    const initialRequests = apiRequests.filter(
      (path) => path === "/api/atlas",
    ).length;
    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/atlas",
    );
    await page.goto(`${base}/map`);
    const response = await responsePromise;
    assert.equal(new URL(response.url()).searchParams.get("format"), "points");
    assert.equal((await response.json()).features.length, 2859);
    await expect(page.locator(".map-status")).toContainText(
      /mapped places? in this area/,
      { timeout: 60000 },
    );
    const nationwideCanvas = page.locator(".maplibregl-canvas");
    const nationwideBox = await nationwideCanvas.boundingBox();
    assert.ok(nationwideBox);
    for (let movement = 0; movement < 5; movement++) {
      await page.mouse.move(
        nationwideBox.x + nationwideBox.width / 2,
        nationwideBox.y + nationwideBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        nationwideBox.x + nationwideBox.width / 2 + 45,
        nationwideBox.y + nationwideBox.height / 2 + 15,
        { steps: 8 },
      );
      await page.mouse.up();
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(350);
    }
    assert.equal(
      apiRequests.filter((path) => path === "/api/atlas").length -
        initialRequests,
      1,
      "2,859-point feeds stay local through real browser pan and zoom events",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS all 2,859 points use one request through browser pans and zooms at ${width}px`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(
  `Fixture feed: ${Buffer.byteLength(JSON.stringify(nationwidePoints))} raw bytes; ${gzipSync(JSON.stringify(nationwidePoints)).byteLength} gzip bytes`,
);
