/** Viewport coverage regression checks, with synthetic mobile browser chrome.
 * PHASM_BASE_URL=http://localhost:5173 PHASM_SCREENSHOT_DIR=/tmp/fog-viewport
 * PHASM_FOG_BROWSERS=chromium,webkit node tests/fog-viewport-browser.mjs
 * Linux WebKit/mobile emulation is not physical iPhone Safari. Synthetic
 * visualViewport events test layout invariants, not a browser's toolbar UI.
 * Read-only: no application, account, or database mutations.
 */
import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const baseURL = process.env.PHASM_BASE_URL || "http://localhost:5173";
const output = process.env.PHASM_SCREENSHOT_DIR || "/tmp/phasm-fog-viewport";
const browserNames = (process.env.PHASM_FOG_BROWSERS || "chromium")
  .split(",")
  .map((name) => name.trim());
const results = [],
  states = [],
  errors = [],
  engines = [];
await mkdir(output, { recursive: true });
const selector = ".atmospheric-fog";

async function check(engine, name, fn) {
  try {
    const detail = await fn();
    results.push({ engine, name, passed: true, detail });
    console.log(`PASS ${engine}: ${name}`);
  } catch (error) {
    results.push({ engine, name, passed: false, error: error.message });
    console.error(`FAIL ${engine}: ${name}: ${error.message}`);
  }
}

function instrument() {
  const stats = { contexts: 0, bitmapWrites: 0, contextLost: 0 };
  window.__fogViewportStats = stats;
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    const context = getContext.call(this, kind, ...args);
    if (
      context &&
      String(kind).includes("webgl") &&
      this.classList.contains("atmospheric-fog-canvas")
    ) {
      stats.contexts++;
      this.addEventListener("webglcontextlost", () => stats.contextLost++);
    }
    return context;
  };
  for (const dimension of ["width", "height"]) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      dimension,
    );
    Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
      ...descriptor,
      set(value) {
        if (this.classList.contains("atmospheric-fog-canvas"))
          stats.bitmapWrites++;
        descriptor.set.call(this, value);
      },
    });
  }
  const nativeViewport = window.visualViewport;
  const viewport = new EventTarget();
  let overrides = {};
  const defaults = {
    width: () => innerWidth,
    height: () => innerHeight,
    offsetLeft: () => 0,
    offsetTop: () => 0,
    pageLeft: () => scrollX,
    pageTop: () => scrollY,
    scale: () => 1,
  };
  for (const [key, fallback] of Object.entries(defaults))
    Object.defineProperty(viewport, key, {
      get: () => overrides[key] ?? fallback(),
    });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    get: () => viewport,
  });
  window.__setFogVisualViewport = (next) => {
    overrides = next;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
  };
  window.__nativeViewportAvailable = Boolean(nativeViewport);
}

async function state(page, engine, stage) {
  const value = await page.evaluate(() => {
    const host = document.querySelector(".atmospheric-fog");
    const canvas = host?.querySelector("canvas");
    const viewport = window.visualViewport;
    return {
      status: host?.dataset.status,
      quality: host?.dataset.quality,
      frame: Number(canvas?.dataset.frame || 0),
      rect: host?.getBoundingClientRect().toJSON(),
      viewport: {
        width: viewport.width,
        height: viewport.height,
        left: viewport.offsetLeft,
        top: viewport.offsetTop,
      },
      layout: { width: innerWidth, height: innerHeight },
      bitmap: { width: canvas?.width, height: canvas?.height },
      canvasCount: document.querySelectorAll(".atmospheric-fog-canvas").length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      stats: { ...window.__fogViewportStats },
    };
  });
  states.push({ engine, stage, ...value });
  return value;
}

function covered(value) {
  const { rect, layout, viewport } = value;
  assert.equal(value.status, "running");
  assert.equal(value.canvasCount, 1);
  assert.ok(rect.left <= Math.min(0, viewport.left) + 1, `left ${rect.left}`);
  assert.ok(rect.top <= Math.min(0, viewport.top) + 1, `top ${rect.top}`);
  assert.ok(
    rect.right >= Math.max(layout.width, viewport.left + viewport.width) - 1,
    `right ${rect.right} does not cover layout/visual viewport`,
  );
  assert.ok(
    rect.bottom >= Math.max(layout.height, viewport.top + viewport.height) - 1,
    `bottom ${rect.bottom} does not cover ${Math.max(layout.height, viewport.top + viewport.height)}`,
  );
  assert.ok(value.overflow <= 1, `horizontal overflow ${value.overflow}`);
}

async function bottomComparison(page, engine, stage) {
  const on = await page.screenshot({
    path: `${output}/${engine}-${stage}.png`,
  });
  await page.locator(selector).evaluate((host) => (host.style.opacity = "0"));
  await page.waitForTimeout(220);
  const off = await page.screenshot();
  await page
    .locator(selector)
    .evaluate((host) => host.style.removeProperty("opacity"));
  await page.waitForTimeout(220);
  const a = await sharp(on)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(off).removeAlpha().raw().toBuffer();
  const { width, height, channels } = a.info;
  let changed = 0,
    total = 0,
    sum = 0;
  for (let y = height - 24; y < height; y++)
    for (let x = 8; x < width - 8; x++) {
      const i = (y * width + x) * channels;
      const delta = Math.max(
        ...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b[i + c])),
      );
      total++;
      sum += delta;
      if (delta >= 2) changed++;
    }
  const detail = {
    band: "bottom24px",
    changedFraction: changed / total,
    meanDelta: sum / total,
  };
  assert.ok(
    detail.changedFraction > 0.03,
    `Bottom is uncovered or invisible: ${JSON.stringify(detail)}`,
  );
  return detail;
}

for (const engine of browserNames) {
  let browser;
  try {
    const browserType = { chromium, webkit }[engine];
    assert.ok(browserType, `Unknown browser ${engine}`);
    browser = await browserType.launch({
      headless: true,
      ...(engine === "webkit" && process.env.PHASM_WEBKIT_EXECUTABLE
        ? { executablePath: process.env.PHASM_WEBKIT_EXECUTABLE }
        : {}),
      ...(engine === "chromium"
        ? { args: ["--no-sandbox", "--enable-unsafe-swiftshader"] }
        : {}),
      ...(process.env.HTTPS_PROXY
        ? {
            proxy: {
              server: process.env.HTTPS_PROXY,
              bypass: "localhost,127.0.0.1",
            },
          }
        : {}),
    });
    engines.push({ engine, version: browser.version() });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push({ engine, message: error.message }),
    );
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(selector)).toHaveAttribute(
      "data-status",
      "running",
      { timeout: 30000 },
    );
    await page.waitForTimeout(1400);
    const initial = await state(page, engine, "initial");
    await check(
      engine,
      "Initial layout and visible bottom coverage",
      async () => {
        covered(initial);
        return await bottomComparison(page, engine, "initial");
      },
    );
    await check(
      engine,
      "Short visual viewport covers the full layout viewport",
      async () => {
        await page.evaluate(() =>
          window.__setFogVisualViewport({ height: 740 }),
        );
        await page.waitForTimeout(350);
        const current = await state(page, engine, "toolbar-expanded");
        await page.screenshot({
          path: `${output}/${engine}-toolbar-expanded.png`,
        });
        covered(current);
        return await bottomComparison(page, engine, "toolbar-bottom");
      },
    );
    await check(
      engine,
      "Keyboard offset preserves coverage above and below the visual viewport",
      async () => {
        await page.evaluate(() =>
          window.__setFogVisualViewport({ height: 460, offsetTop: 160 }),
        );
        await page.waitForTimeout(350);
        const current = await state(page, engine, "keyboard-offset");
        await page.screenshot({
          path: `${output}/${engine}-keyboard-offset.png`,
        });
        covered(current);
      },
    );
    await check(
      engine,
      "Repeated browser chrome changes reuse bitmap and renderer",
      async () => {
        await page.evaluate(() => window.__setFogVisualViewport({}));
        await page.waitForTimeout(450);
        const before = await state(page, engine, "before-toolbar-cycle");
        for (const height of [740, 780, 820, 844, 740, 844]) {
          await page.evaluate(
            (height) => window.__setFogVisualViewport({ height }),
            height,
          );
          await page.waitForTimeout(90);
        }
        await page.waitForTimeout(350);
        const after = await state(page, engine, "after-toolbar-cycle");
        covered(after);
        assert.ok(
          after.frame > before.frame,
          "Animation stopped during viewport events",
        );
        assert.equal(
          after.stats.contexts,
          initial.stats.contexts,
          "Renderer was recreated",
        );
        assert.equal(
          after.stats.bitmapWrites,
          before.stats.bitmapWrites,
          "Toolbar changes resized/cleared the drawing buffer",
        );
        return {
          framesAdvanced: after.frame - before.frame,
          bitmapWrites: after.stats.bitmapWrites - before.stats.bitmapWrites,
        };
      },
    );
    await check(
      engine,
      "Window resize and orientation cover the visible page with one context",
      async () => {
        await page.evaluate(() => window.__setFogVisualViewport({}));
        for (const viewport of [
          { width: 390, height: 740 },
          { width: 390, height: 844 },
          { width: 844, height: 390 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(350);
          covered(
            await state(
              page,
              engine,
              `resize-${viewport.width}x${viewport.height}`,
            ),
          );
        }
        const last = await state(page, engine, "resize-complete");
        assert.equal(last.stats.contexts, initial.stats.contexts);
        assert.equal(last.stats.contextLost, 0);
        return await bottomComparison(page, engine, "resize-complete");
      },
    );
    await check(
      engine,
      "Scrolled sections retain bottom coverage",
      async () => {
        await page.locator(".home-featured").scrollIntoViewIfNeeded();
        await page.waitForTimeout(450);
        covered(await state(page, engine, "scrolled"));
        return await bottomComparison(page, engine, "scrolled");
      },
    );
    await check(
      engine,
      "No browser exceptions or lost graphics contexts",
      async () => {
        assert.deepEqual(
          errors.filter((error) => error.engine === engine),
          [],
        );
        const last = await state(page, engine, "final");
        assert.equal(last.stats.contextLost, 0);
        assert.equal(last.stats.contexts, 1);
      },
    );
    await context.close();
  } catch (error) {
    results.push({
      engine,
      name: "Browser setup/scenario",
      passed: false,
      error: error.message,
    });
    console.error(`${engine}: ${error.stack}`);
  } finally {
    await browser?.close();
  }
}
await writeFile(
  `${output}/report.json`,
  JSON.stringify(
    {
      baseURL,
      checkedAt: new Date().toISOString(),
      environment:
        "Linux Playwright with software rendering; synthetic visualViewport events and touch emulation, not physical iPhone Safari",
      engines,
      results,
      states,
      errors,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${results.filter((result) => result.passed).length}/${results.length} checks passed`,
);
if (results.some((result) => !result.passed) || errors.length)
  process.exitCode = 1;
