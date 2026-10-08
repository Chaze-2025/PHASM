/** Capture full-page desktop/mobile visual review artifacts against a running app.
 * Set PHASM_BASE_URL, PHASM_SCREENSHOT_DIR, and optionally PHASM_SOURCE_COMMIT.
 * All location and archival images are loaded before screenshots are captured.
 * Chromium touch emulation is not physical iPhone or Safari testing.
 */
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const source = process.env.PHASM_BASE_URL;
const output = process.env.PHASM_SCREENSHOT_DIR;
if (!source || !output)
  throw new Error("Set PHASM_BASE_URL and PHASM_SCREENSHOT_DIR");
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
const checks = [];
try {
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: label === "mobile",
      hasTouch: label === "mobile",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    for (const [name, route] of [
      ["homepage", "/"],
      ["map", "/map"],
      ["stanley-hotel", "/locations/stanley-hotel"],
    ]) {
      await page.goto(source + route, { waitUntil: "networkidle" });
      await expect(page.locator("h1")).toBeVisible();
      if (name === "map")
        await expect(page.locator(".map-status")).toContainText(
          /places in this area/,
          { timeout: 60000 },
        );
      const photos = page.locator("img:visible");
      for (let i = 0; i < (await photos.count()); i++) {
        await photos.nth(i).scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            photos.nth(i).evaluate((e) => e.complete && e.naturalWidth > 0),
          )
          .toBe(true);
      }
      await page.evaluate(() => {
        for (const element of document.querySelectorAll("*")) {
          if (element.scrollTop || element.scrollLeft) element.scrollTo(0, 0);
        }
        scrollTo(0, 0);
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const screenshot = await page.screenshot({ fullPage: true });
      const file = `${name}-${label}.png`;
      await sharp(screenshot)
        .png({ palette: true, quality: 95, compressionLevel: 9 })
        .toFile(`${output}/${file}`);
      checks.push({
        name,
        label,
        route,
        width,
        height,
        title: await page.locator("h1").innerText(),
        file,
        imageCount: await photos.count(),
        sizes: await page.evaluate(() => ({
          viewport: innerWidth,
          body: document.body.scrollWidth,
          document: document.documentElement.scrollWidth,
        })),
      });
      console.log(`Captured ${label} ${name}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/capture.json`,
  JSON.stringify(
    {
      source,
      sourceCommit: process.env.PHASM_SOURCE_COMMIT || null,
      capturedAt: new Date().toISOString(),
      browser:
        "Chromium with reduced motion; touch and viewport emulation, not physical iPhone testing",
      checks,
    },
    null,
    2,
  ) + "\n",
);
