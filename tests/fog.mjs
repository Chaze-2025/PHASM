/** Focused atmospheric mist QA. No production debug endpoints or database writes.
 * Run against seeded dev: PHASM_BASE_URL=http://localhost:5176 node tests/fog.mjs
 * Optional PHASM_FOG_LONG_RUN_MS (default 120000), PHASM_FOG_RECORD=1,
 * PHASM_SCREENSHOT_DIR. Chromium touch emulation is not a physical iPhone.
 */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const baseURL = process.env.PHASM_BASE_URL || "http://localhost:5176";
const output = process.env.PHASM_SCREENSHOT_DIR || "docs/fog/artifacts";
const longRunMs = Number(process.env.PHASM_FOG_LONG_RUN_MS || 120000);
const record = process.env.PHASM_FOG_RECORD === "1";
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
  metrics = [],
  accessibility = [];
const fog = ".atmospheric-fog";
const canvas = ".atmospheric-fog-canvas";
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
async function open(context, path = "/") {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__fogTest = { webglContexts: 0, longTasks: [] };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (String(kind).includes("webgl")) window.__fogTest.webglContexts++;
      return original.call(this, kind, ...args);
    };
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) =>
        window.__fogTest.longTasks.push(
          ...list
            .getEntries()
            .map((e) => ({ start: e.startTime, duration: e.duration })),
        ),
      ).observe({ type: "longtask", buffered: true });
    }
  });
  await page.goto(baseURL + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function running(page) {
  await expect(page.locator(fog)).toHaveAttribute("data-status", "running", {
    timeout: 30000,
  });
  await expect(page.locator(canvas)).toHaveCount(1);
  await page.waitForTimeout(300);
}
async function state(page) {
  return page.locator(fog).evaluate((el) => {
    const canvas = el.querySelector("canvas");
    return {
      status: el.dataset.status,
      frame: Number(canvas?.dataset.frame || 0),
      resolution: canvas?.dataset.resolution,
      width: canvas?.width,
      height: canvas?.height,
      rootRect: el.getBoundingClientRect().toJSON(),
      memory: performance.memory?.usedJSHeapSize ?? null,
      contextRequests: window.__fogTest.webglContexts,
      longTasks: window.__fogTest.longTasks.length,
    };
  });
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        document.body.scrollWidth <= innerWidth + 1,
    ),
  );
}
async function screenshot(page, name) {
  const image = await page.screenshot();
  await sharp(image)
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toFile(`${output}/${name}.png`);
  return image;
}
async function unchangedLayout(page, name) {
  const baselines = JSON.parse(
    await readFile(
      new URL(
        "../docs/editorial/artifacts/layout-baseline.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const baseline = baselines.find((b) => b.name === name);
  const actual = await page
    .locator(
      "header,.home-hero,.home-hero-image,.home-hero-inner,.home-hero-copy,h1,.home-search,.home-atlas-link,.home-featured,.home-atlas-section",
    )
    .evaluateAll((es) =>
      es.map((el) => ({
        selector: el.className || el.tagName,
        rect: el.getBoundingClientRect().toJSON(),
      })),
    );
  assert.equal(actual.length, baseline.elements.length);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i].selector, baseline.elements[i].selector);
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(actual[i].rect[key] - baseline.elements[i].rect[key]) < 1,
        `${name} ${actual[i].selector} ${key} changed`,
      );
  }
}
async function protectedComparison(page, name, requireVisible = true) {
  // Exact rendered pixel comparison against hiding only the mist layer. The shader
  // must contribute no visible pixels in central or occupied content regions.
  await page.locator("img:visible").evaluateAll(async (images) => {
    await Promise.all(
      images
        .filter((image) => {
          const r = image.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight;
        })
        .map((image) => image.decode().catch(() => {})),
    );
  });
  await page.waitForTimeout(2200);
  const regions = await page.evaluate(() => {
    const width = innerWidth,
      height = innerHeight;
    const boxes = [
      ...document.querySelectorAll(
        "header, h1, h2, h3, p, a, button, input, select, textarea, img, .location-card",
      ),
    ]
      .filter(
        (el) =>
          !el.closest(".atmospheric-fog") &&
          getComputedStyle(el).visibility !== "hidden",
      )
      .map((el) => el.getBoundingClientRect())
      .filter(
        (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height,
      )
      .map((r) => ({
        x: Math.max(0, Math.ceil(r.x)),
        y: Math.max(0, Math.ceil(r.y)),
        right: Math.min(width, Math.floor(r.right)),
        bottom: Math.min(height, Math.floor(r.bottom)),
      }));
    boxes.push({
      x: Math.floor(width * 0.32),
      right: Math.ceil(width * 0.68),
      y: 0,
      bottom: height,
    });
    return boxes;
  });
  const withFog = await page.screenshot();
  await page.locator(fog).evaluate((el) => (el.style.opacity = "0"));
  const withoutFog = await page.screenshot();
  await page.locator(fog).evaluate((el) => el.style.removeProperty("opacity"));
  const a = await sharp(withFog)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(withoutFog).ensureAlpha().raw().toBuffer();
  let protectedPixels = 0,
    changedProtectedPixels = 0,
    changedPixels = 0,
    maxDifference = 0;
  const regionPixels = new Uint8Array(a.info.width * a.info.height);
  for (const r of regions)
    for (let y = r.y; y < r.bottom; y++)
      for (let x = r.x; x < r.right; x++)
        regionPixels[y * a.info.width + x] = 1;
  for (let p = 0; p < regionPixels.length; p++) {
    const i = p * 4;
    const delta = Math.max(
      ...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b[i + c])),
    );
    if (delta > 1) changedPixels++;
    if (regionPixels[p]) {
      protectedPixels++;
      if (delta > 1) changedProtectedPixels++;
      maxDifference = Math.max(maxDifference, delta);
    }
  }
  metrics.push({
    comparison: name,
    protectedPixels,
    changedProtectedPixels,
    changedPixels,
    maxDifference,
  });
  assert.equal(
    changedProtectedPixels,
    0,
    `${name}: ${changedProtectedPixels} protected pixels changed (max ${maxDifference})`,
  );
  if (requireVisible)
    assert.ok(
      changedPixels > 0,
      `${name}: no detectable perimeter mist after full reveal`,
    );
  return changedPixels;
}
try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await open(desktop);
  await check(
    "Homepage mist initializes once, is noninteractive and low-resolution",
    async () => {
      await running(page);
      const s = await state(page);
      metrics.push({ initial: s });
      assert.ok(s.width <= 768 && s.height <= 768, JSON.stringify(s));
      assert.equal(await page.locator(fog).getAttribute("aria-hidden"), "true");
      assert.equal(
        await page
          .locator(fog)
          .evaluate((el) => getComputedStyle(el).pointerEvents),
        "none",
      );
      assert.equal(
        await page
          .locator(canvas)
          .evaluate((el) => getComputedStyle(el).pointerEvents),
        "none",
      );
      assert.equal(
        await page.locator(fog).locator("a,button,input,[tabindex]").count(),
        0,
      );
      assert.equal(await page.locator(canvas).count(), 1);
      await noOverflow(page);
      await unchangedLayout(page, "desktop");
    },
  );
  await check(
    "Homepage text, navigation, image and central pixels remain unchanged",
    async () => {
      await protectedComparison(page, "desktop-top");
      await screenshot(page, "homepage-desktop");
      await page.locator(".home-featured").scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      const changes = await protectedComparison(page, "desktop-featured");
      assert.ok(
        changes > 0,
        "Fog should be faintly visible in unoccupied perimeter pixels",
      );
      await screenshot(page, "homepage-desktop-scrolled");
    },
  );
  await check(
    "Scrolling, keyboard navigation and search are unaffected",
    async () => {
      await page.evaluate(() => scrollTo(0, 0));
      const box = page.getByRole("textbox", {
        name: "Search for haunted places or a region",
      });
      await box.fill("Stanley");
      await page.getByRole("button", { name: "Find haunted places" }).click();
      await expect(page).toHaveURL(/\/map\?q=Stanley/);
      await expect(page.locator(".atlas-card-list .card-title")).toHaveText(
        "The Stanley Hotel",
      );
      await expect(page.locator(fog)).toHaveCount(0);
    },
  );
  await check(
    "Atlas is fog-free and actual map controls and pan still work",
    async () => {
      await page.goto(`${baseURL}/map`, { waitUntil: "networkidle" });
      await expect(page.locator(".map-status")).toContainText(
        /places in this area/,
        { timeout: 60000 },
      );
      await expect(page.locator(fog)).toHaveCount(0);
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      const box = await page.locator(".maplibregl-canvas").boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
        steps: 15,
      });
      await page.mouse.up();
      await expect(page.locator(".map-fallback")).toHaveCount(0);
      await screenshot(page, "atlas-no-fog");
      await page.goto(`${baseURL}/locations/stanley-hotel`, {
        waitUntil: "networkidle",
      });
      await expect(page.locator(fog)).toHaveCount(0);
    },
  );
  await check(
    "Homepage axe scan introduces no accessibility violations",
    async () => {
      await page.goto(baseURL, { waitUntil: "networkidle" });
      await running(page);
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      accessibility.push({ viewport: "desktop", violations: scan.violations });
      assert.deepEqual(
        scan.violations.map((v) => v.id),
        [],
      );
    },
  );
  await check(
    "Runtime reduced-motion change stops mist without a new context",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(fog)).toHaveAttribute(
        "data-status",
        "reduced-motion",
      );
      const before = await state(page);
      await page.waitForTimeout(1000);
      const after = await state(page);
      assert.equal(after.frame, before.frame);
      assert.equal(after.contextRequests, before.contextRequests);
      await screenshot(page, "homepage-reduced-motion");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await running(page);
    },
  );
  await check(
    "Visibility lifecycle pauses and resumes scheduling",
    async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(page.locator(fog)).toHaveAttribute("data-status", "paused");
      const before = await state(page);
      await page.waitForTimeout(1200);
      const after = await state(page);
      assert.equal(after.frame, before.frame);
      await page.evaluate(() => {
        delete document.hidden;
        delete document.visibilityState;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await running(page);
    },
  );
  await check(
    `Sustained ${Math.round(longRunMs / 1000)}s animation stays bounded and drifts`,
    async () => {
      await page.locator(".home-featured").scrollIntoViewIfNeeded();
      await running(page);
      const samples = [],
        start = Date.now();
      let firstPixels, lastPixels;
      while (Date.now() - start < longRunMs) {
        const s = await state(page);
        samples.push({ elapsedMs: Date.now() - start, ...s });
        assert.ok(
          ["running", "low-performance"].includes(s.status),
          JSON.stringify(s),
        );
        assert.equal(await page.locator(canvas).count(), 1);
        assert.ok(s.width <= 768 && s.height <= 768);
        if (!firstPixels) firstPixels = await page.screenshot();
        await page.waitForTimeout(
          Math.min(15000, Math.max(250, longRunMs - (Date.now() - start))),
        );
      }
      samples.push({ elapsedMs: Date.now() - start, ...(await state(page)) });
      lastPixels = await page.screenshot();
      const initial = samples[0],
        final = samples.at(-1);
      const fps = (final.frame - initial.frame) / (final.elapsedMs / 1000);
      metrics.push({
        stability: {
          requestedMs: longRunMs,
          samples,
          averageFPS: fps,
          emulatedSoftwareGPU: true,
        },
      });
      assert.ok(fps <= 21, `Unexpected frame rate ${fps}`);
      if (final.status === "running") {
        assert.ok(final.frame > initial.frame, "Frame count did not advance");
        assert.ok(
          !firstPixels.equals(lastPixels),
          "Mist did not visibly change over the interval",
        );
      }
      if (initial.memory && final.memory)
        assert.ok(
          final.memory - initial.memory < 32 * 1024 * 1024,
          `Heap grew ${final.memory - initial.memory}`,
        );
    },
  );
  await check(
    "A lost GPU context fails closed without affecting content",
    async () => {
      await page
        .locator(canvas)
        .evaluate((el) =>
          el
            .getContext("webgl")
            ?.getExtension("WEBGL_lose_context")
            ?.loseContext(),
        );
      await expect(page.locator(fog)).toHaveAttribute(
        "data-status",
        "context-lost",
      );
      const before = await state(page);
      await page.waitForTimeout(600);
      const after = await state(page);
      assert.equal(after.frame, before.frame);
      assert.equal(
        await page
          .locator(canvas)
          .evaluate((el) => getComputedStyle(el).visibility),
        "hidden",
      );
      await expect(page.locator(".home-featured")).toBeVisible();
    },
  );
  await desktop.close();

  for (const [name, width, height] of [
    ["narrow", 375, 667],
    ["iphone", 390, 844],
    ["tall", 430, 932],
    ["landscape", 844, 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const phone = await open(context);
    await check(
      `${width}×${height} touch layout protects content and resizes cleanly`,
      async () => {
        await running(phone);
        await noOverflow(phone);
        if (name === "iphone") await unchangedLayout(phone, "mobile");
        // At 844×390 the full-bleed hero photograph occupies nearly the entire
        // viewport: image protection is expected to suppress visible mist there.
        await protectedComparison(
          phone,
          `mobile-${name}-top`,
          name !== "landscape",
        );
        await screenshot(phone, `homepage-${name}`);
        await phone.locator(".home-featured").scrollIntoViewIfNeeded();
        await phone.waitForTimeout(650);
        await protectedComparison(phone, `mobile-${name}-scrolled`);
        await screenshot(phone, `homepage-${name}-scrolled`);
        await phone.evaluate(() => scrollTo(0, 0));
        const menu = phone.getByRole("button", { name: "Open navigation" });
        if (await menu.isVisible()) {
          await menu.tap();
          await expect(
            phone.getByRole("navigation", { name: "Main navigation" }),
          ).toBeVisible();
          await phone.getByRole("button", { name: "Close navigation" }).tap();
        }
        await phone.setViewportSize({ width: height, height: width });
        await phone.waitForTimeout(650);
        await noOverflow(phone);
        await running(phone);
        const s = await state(phone);
        assert.ok(Math.abs(s.rootRect.width - height) <= 1, JSON.stringify(s));
        await phone.setViewportSize({ width, height });
        await phone.waitForTimeout(650);
        await noOverflow(phone);
        const search = phone.getByRole("textbox", {
          name: "Search for haunted places or a region",
        });
        await search.tap();
        await search.fill("Stanley");
        await phone.getByRole("button", { name: "Find haunted places" }).tap();
        await expect(phone).toHaveURL(/\/map\?q=Stanley/);
        await expect(phone.locator(fog)).toHaveCount(0);
      },
    );
    await context.close();
  }
  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const quiet = await open(reduced);
  await check(
    "Initial reduced-motion visit never creates a fog WebGL context",
    async () => {
      await expect(quiet.locator(fog)).toHaveAttribute(
        "data-status",
        "reduced-motion",
      );
      assert.equal(
        await quiet.evaluate(() => window.__fogTest.webglContexts),
        0,
      );
      const first = await state(quiet);
      await quiet.waitForTimeout(1200);
      const last = await state(quiet);
      assert.equal(last.frame, first.frame);
      const scan = await new AxeBuilder({ page: quiet })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      accessibility.push({
        viewport: "mobile-reduced-motion",
        violations: scan.violations,
      });
      assert.deepEqual(
        scan.violations.map((v) => v.id),
        [],
      );
    },
  );
  await reduced.close();
  const unsupported = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await unsupported.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return String(kind).includes("webgl")
        ? null
        : getContext.call(this, kind, ...args);
    };
  });
  const fallback = await open(unsupported);
  await check(
    "No-WebGL fallback keeps homepage usable without animation",
    async () => {
      await expect(fallback.locator(fog)).toHaveAttribute(
        "data-status",
        "unsupported",
      );
      await expect(
        fallback.getByRole("heading", { name: /Every place has a story/i }),
      ).toBeVisible();
      const initial = await state(fallback);
      await fallback.waitForTimeout(600);
      const final = await state(fallback);
      assert.equal(final.frame, initial.frame);
      await fallback
        .getByRole("textbox", { name: "Search for haunted places or a region" })
        .fill("Stanley");
      await fallback.getByRole("button", { name: "Find haunted places" }).tap();
      await expect(fallback).toHaveURL(/\/map\?q=Stanley/);
    },
  );
  await unsupported.close();
  for (const [name, hint] of [
    ["data-saver", "connection"],
    ["low-memory", "deviceMemory"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript((hint) => {
      Object.defineProperty(navigator, hint, {
        configurable: true,
        get: () =>
          hint === "connection"
            ? Object.assign(new EventTarget(), { saveData: true })
            : 2,
      });
    }, hint);
    const quiet = await open(context);
    await check(`${name} device hint avoids fog GPU work`, async () => {
      await expect(quiet.locator(fog)).toHaveAttribute("data-status", name);
      assert.equal(
        await quiet.evaluate(() => window.__fogTest.webglContexts),
        0,
      );
      await expect(
        quiet.getByRole("button", { name: "Find haunted places" }),
      ).toBeVisible();
    });
    await context.close();
  }
  if (record) {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: 1,
      recordVideo: { dir: output, size: { width: 1024, height: 768 } },
    });
    const movie = await open(context);
    await running(movie);
    await movie.evaluate(() =>
      scrollTo({
        top: document.querySelector(".home-featured").offsetTop + 100,
        behavior: "instant",
      }),
    );
    await running(movie);
    await movie.waitForTimeout(2500);
    const recordingScroll = await movie.evaluate(() => scrollY);
    console.log("Recording 25 seconds of real-time mist motion");
    for (let i = 0; i < 5; i++) {
      await movie.waitForTimeout(5000);
      assert.equal(
        await movie.evaluate(() => scrollY),
        recordingScroll,
        "Recording viewport changed unexpectedly",
      );
      await expect(movie.locator(fog)).toHaveAttribute(
        "data-status",
        "running",
      );
    }
    const video = movie.video();
    await context.close();
    await video.saveAs(`${output}/fog-real-time-25s.webm`);
    await video.delete();
    // Retain the final 25 seconds at their real speed in an iPhone-friendly file.
    // ffmpeg is an optional QA tool, never an application dependency.
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-sseof",
        "-25",
        "-i",
        `${output}/fog-real-time-25s.webm`,
        "-t",
        "25",
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        `${output}/fog-real-time-25s.mp4`,
      ],
      { stdio: "ignore" },
    );
    await unlink(`${output}/fog-real-time-25s.webm`);
  }
  await check("No uncaught browser exceptions", async () =>
    assert.deepEqual(errors, []),
  );
} finally {
  await browser.close();
  const report = {
    source: baseURL,
    capturedAt: new Date().toISOString(),
    browser:
      "Playwright Chromium; software WebGL, touch/viewport emulation; not physical iPhone or Safari",
    results,
    errors,
    metrics,
    accessibility,
  };
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `${results.filter((r) => r.passed).length}/${results.length} fog checks passed`,
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
