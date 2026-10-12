/** Read-only regression check: responsive cards must not fetch original photos
 * when filters, pagination, or navigation remove them from the document. */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.PHASM_BASE_URL || "http://localhost:5173";
const output =
  process.env.PHASM_IMAGE_OUTPUT ||
  "/workspace/phasm-performance/image-loading";
const originals =
  /\/images\/(?:stanley-hotel|eastern-state-penitentiary|edinburgh-castle|winchester-mystery-house|pendle-hill)\.webp$/;
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

async function navigate(page, label) {
  await page.evaluate(() => scrollTo(0, 0));
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: label, exact: true })
    .click();
}

async function homeImages(page) {
  await expect(page.locator(".home-featured .card-image img")).toHaveCount(3);
  await page.locator(".home-featured").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".home-featured .card-image img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  return page
    .locator(".home-featured .card-image img")
    .evaluateAll((images) =>
      images.map((image) => ({
        src: image.currentSrc,
        width: image.getBoundingClientRect().width,
      })),
    );
}

try {
  for (const [name, width, deviceScaleFactor] of [
    ["desktop", 1440, 1],
    ["mobile", 390, 2],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const requestedOriginals = [];
    page.on("request", (request) => {
      if (originals.test(new URL(request.url()).pathname))
        requestedOriginals.push(request.url());
    });
    try {
      await page.goto(base, { waitUntil: "networkidle" });
      const images = await homeImages(page);
      assert.ok(
        images.every((image) => image.src.endsWith("-card.webp")),
        JSON.stringify(images),
      );
      await navigate(page, "Haunted Atlas");
      await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(
        24,
      );
      if (name === "desktop") {
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(page.locator(".pagination")).toContainText("Page 2 of");
        await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(
          24,
        );
        await page.locator(".filter-toggle").click();
        await page
          .getByRole("combobox", { name: "Region", exact: true })
          .selectOption("Europe");
        await expect(page.locator(".atlas-card-list")).toContainText(
          "Edinburgh Castle",
        );
        await expect(page.locator(".atlas-card-list")).not.toContainText(
          "The Stanley Hotel",
        );
        await page
          .getByRole("button", { name: "Close filters", exact: true })
          .click();
      }
      await navigate(page, "Discover");
      await homeImages(page);
      await page.waitForTimeout(500);
      assert.deepEqual(
        requestedOriginals,
        [],
        "Departing cards requested full-resolution originals",
      );
      results.push({
        name,
        passed: true,
        deviceScaleFactor,
        images,
        requestedOriginals,
      });
      console.log(`PASS ${name}: card selection and departing-image requests`);
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error.message,
        requestedOriginals,
      });
      console.error(`FAIL ${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await mkdir(output, { recursive: true });
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ base, results }, null, 2),
  );
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
