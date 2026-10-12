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
    window.__fogTest = {
      webglContexts: 0,
      textMeasurements: 0,
      maskUpdates: 0,
      longTasks: [],
    };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (String(kind).includes("webgl")) window.__fogTest.webglContexts++;
      return original.call(this, kind, ...args);
    };
    const originalRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function (...args) {
      window.__fogTest.textMeasurements++;
      return originalRects.apply(this, args);
    };
    const originalTextureUpdate = WebGLRenderingContext.prototype.texSubImage2D;
    WebGLRenderingContext.prototype.texSubImage2D = function (...args) {
      window.__fogTest.maskUpdates++;
      return originalTextureUpdate.apply(this, args);
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
async function layeredComparison(page, name) {
  // Compare only the decorative overlay with the same static page underneath.
  // Cards, photos and the middle of the page must receive mist; reading and
  // controls retain a bounded luminance change instead of rectangular cutouts.
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
    const clip = (r) => ({
      x: Math.max(0, Math.ceil(r.left ?? r.x)),
      y: Math.max(0, Math.ceil(r.top ?? r.y)),
      right: Math.min(width, Math.floor(r.right)),
      bottom: Math.min(height, Math.floor(r.bottom)),
    });
    const visible = (r) =>
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < height &&
      r.right > 0 &&
      r.left < width;
    const boxes = (selector) =>
      [...document.querySelectorAll(selector)]
        .filter(
          (el) =>
            !el.closest(".atmospheric-fog") &&
            getComputedStyle(el).visibility !== "hidden",
        )
        .map((el) => el.getBoundingClientRect())
        .filter(visible);
    const text = [];
    const walker = document.createTreeWalker(
      document.querySelector(".home-page"),
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (
        !node.textContent.trim() ||
        !parent ||
        parent.closest("script,style,.atmospheric-fog")
      )
        continue;
      if (getComputedStyle(parent).visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      text.push(...[...range.getClientRects()].filter(visible).map(clip));
    }
    const surfaces = boxes(".location-card,.home-atlas-panel,.home-archive");
    const edgeInside = [],
      edgeOutside = [];
    // Observe paired bands across actual card/panel edges. This detects the old
    // rectangular exclusions without demanding fog in every turbulent hollow.
    for (const r of surfaces) {
      if (r.width < 80 || r.height < 80) continue;
      if (r.left >= 8 && r.left + 8 < width) {
        edgeInside.push(
          clip({
            left: r.left + 1,
            right: r.left + 7,
            top: r.top + 12,
            bottom: r.bottom - 12,
          }),
        );
        edgeOutside.push(
          clip({
            left: r.left - 7,
            right: r.left - 1,
            top: r.top + 12,
            bottom: r.bottom - 12,
          }),
        );
      }
      if (r.right <= width - 8 && r.right - 8 > 0) {
        edgeInside.push(
          clip({
            left: r.right - 7,
            right: r.right - 1,
            top: r.top + 12,
            bottom: r.bottom - 12,
          }),
        );
        edgeOutside.push(
          clip({
            left: r.right + 1,
            right: r.right + 7,
            top: r.top + 12,
            bottom: r.bottom - 12,
          }),
        );
      }
      if (r.top >= 8 && r.top + 8 < height) {
        edgeInside.push(
          clip({
            left: r.left + 12,
            right: r.right - 12,
            top: r.top + 1,
            bottom: r.top + 7,
          }),
        );
        edgeOutside.push(
          clip({
            left: r.left + 12,
            right: r.right - 12,
            top: r.top - 7,
            bottom: r.top - 1,
          }),
        );
      }
      if (r.bottom <= height - 8 && r.bottom - 8 > 0) {
        edgeInside.push(
          clip({
            left: r.left + 12,
            right: r.right - 12,
            top: r.bottom - 7,
            bottom: r.bottom - 1,
          }),
        );
        edgeOutside.push(
          clip({
            left: r.left + 12,
            right: r.right - 12,
            top: r.bottom + 1,
            bottom: r.bottom + 7,
          }),
        );
      }
    }
    return {
      text,
      controls: boxes(
        ".home-page button,.home-page input,.home-page select,.home-page textarea",
      ).map(clip),
      header: boxes(".site-header").map(clip),
      center: [
        {
          x: Math.floor(width * 0.32),
          right: Math.ceil(width * 0.68),
          y: 0,
          bottom: height,
        },
      ],
      bottom: [{ x: 0, right: width, y: height - 24, bottom: height }],
      surfaces: surfaces.map(clip),
      photos: boxes(".home-page img").map(clip),
      edgeInside,
      edgeOutside,
    };
  });
  const withFog = await page.screenshot();
  await page.locator(fog).evaluate((el) => (el.style.opacity = "0"));
  await page.waitForTimeout(220);
  const withoutFog = await page.screenshot();
  await page.locator(fog).evaluate((el) => el.style.removeProperty("opacity"));
  await page.waitForTimeout(220);
  const a = await sharp(withFog)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(withoutFog).ensureAlpha().raw().toBuffer();
  const differences = new Uint8Array(a.info.width * a.info.height);
  for (let p = 0; p < differences.length; p++) {
    const i = p * 4;
    differences[p] = Math.max(
      ...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b[i + c])),
    );
  }
  const measured = {};
  for (const [category, boxes] of Object.entries(regions)) {
    const mask = new Uint8Array(differences.length);
    for (const r of boxes)
      for (let y = r.y; y < r.bottom; y++)
        for (let x = r.x; x < r.right; x++) mask[y * a.info.width + x] = 1;
    const histogram = new Uint32Array(256);
    let pixels = 0,
      changedPixels = 0,
      sum = 0,
      maxDifference = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const delta = differences[p];
      pixels++;
      histogram[delta]++;
      sum += delta;
      if (delta > 1) changedPixels++;
      maxDifference = Math.max(maxDifference, delta);
    }
    let cumulative = 0,
      p99 = 0;
    for (; p99 < 255; p99++) {
      cumulative += histogram[p99];
      if (cumulative >= pixels * 0.99) break;
    }
    measured[category] = {
      pixels,
      changedPixels,
      maxDifference,
      p99,
      meanDifference: pixels ? sum / pixels : 0,
    };
  }
  metrics.push({ comparison: name, regions: measured });
  for (const category of ["text", "controls"]) {
    const m = measured[category];
    if (!m.pixels) continue;
    assert.ok(
      m.p99 <= 28 && m.maxDifference <= 45,
      `${name}: ${category} mist exceeds reading budget ${JSON.stringify(m)}`,
    );
  }
  assert.equal(
    measured.header.changedPixels,
    0,
    `${name}: header should stay above the mist`,
  );
  for (const category of [
    "center",
    "bottom",
    "surfaces",
    "photos",
    "edgeInside",
    "edgeOutside",
  ]) {
    const m = measured[category];
    if (m.pixels < 100) continue;
    assert.ok(
      m.changedPixels >= Math.max(10, m.pixels * 0.001),
      `${name}: no meaningful mist over ${category}: ${JSON.stringify(m)}`,
    );
  }
  return measured;
}

async function continuousScroll(page, name) {
  const before = await state(page);
  const samples = await page.evaluate(async () => {
    const host = document.querySelector(".atmospheric-fog");
    const canvas = host.querySelector("canvas");
    const target =
      document.querySelector(".home-atlas-section").getBoundingClientRect()
        .top + scrollY;
    const start = scrollY;
    const readings = [];
    for (let step = 0; step <= 16; step++) {
      window.scrollTo(0, start + ((target - start) * step) / 16);
      await new Promise((resolve) => setTimeout(resolve, 65));
      readings.push({
        status: host.dataset.status,
        visibility: getComputedStyle(canvas).visibility,
        frame: Number(canvas.dataset.frame || 0),
      });
    }
    return readings;
  });
  const after = await state(page);
  metrics.push({ continuousScroll: name, samples });
  assert.ok(
    samples.every((s) => s.status === "running" && s.visibility === "visible"),
    `${name}: mist disappeared or restarted during scrolling ${JSON.stringify(samples)}`,
  );
  assert.ok(
    after.frame > before.frame,
    `${name}: animation stopped during scroll`,
  );
  assert.equal(
    after.contextRequests,
    before.contextRequests,
    `${name}: scrolling recreated WebGL`,
  );
}

try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await open(desktop);
  await check(
    "Homepage mist initializes once, is noninteractive and stays within its render budget",
    async () => {
      await running(page);
      const s = await state(page);
      metrics.push({ initial: s });
      assert.ok(
        s.width <= 1024 && s.height <= 1024 && s.width * s.height <= 550000,
        JSON.stringify(s),
      );
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
    "Homepage fog crosses content surfaces while text and controls remain readable",
    async () => {
      await layeredComparison(page, "desktop-top");
      await screenshot(page, "homepage-desktop");
      await page.locator(".home-featured").scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await layeredComparison(page, "desktop-featured");
      await screenshot(page, "homepage-desktop-scrolled");
      await continuousScroll(page, "desktop");
      await layeredComparison(page, "desktop-atlas-panel");
      await screenshot(page, "homepage-atlas-panel");
    },
  );
  await check(
    "Scrolling reuses text geometry and content changes refresh the fog mask",
    async () => {
      await page.evaluate(() => scrollTo(0, 0));
      await running(page);
      const measurements = await page.evaluate(async () => {
        // Stay inside the already-loaded hero so lazy-image loads do not
        // legitimately invalidate the cache during this scroll-only check.
        const before = window.__fogTest.textMeasurements;
        const uploadsBefore = window.__fogTest.maskUpdates;
        for (const top of [80, 120, 40, 0]) {
          scrollTo(0, top);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          before,
          after: window.__fogTest.textMeasurements,
          uploadsBefore,
          uploadsAfter: window.__fogTest.maskUpdates,
        };
      });
      assert.ok(measurements.before > 0, "Text geometry was never collected");
      assert.equal(measurements.after, measurements.before);
      assert.ok(measurements.uploadsAfter > measurements.uploadsBefore);
      const text = page.locator(".home-hero-copy > p");
      const originalText = await text.textContent();
      try {
        await text.evaluate((el) => el.append(" A new line of field notes."));
        await expect
          .poll(() => page.evaluate(() => window.__fogTest.textMeasurements))
          .toBeGreaterThan(measurements.after);
      } finally {
        await text.evaluate(
          (el, content) => (el.textContent = content),
          originalText,
        );
      }
      await running(page);
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
        if (samples.length) {
          assert.ok(
            s.frame >= samples.at(-1).frame,
            "Renderer restarted during stability sampling",
          );
          assert.equal(
            s.contextRequests,
            samples[0].contextRequests,
            "Document or graphics context changed during stability sampling",
          );
        }
        samples.push({ elapsedMs: Date.now() - start, ...s });
        assert.ok(
          ["running", "low-performance"].includes(s.status),
          JSON.stringify(s),
        );
        assert.equal(await page.locator(canvas).count(), 1);
        assert.ok(
          s.width <= 1024 && s.height <= 1024 && s.width * s.height <= 550000,
        );
        if (!firstPixels) firstPixels = await page.screenshot();
        await page.waitForTimeout(
          Math.min(15000, Math.max(250, longRunMs - (Date.now() - start))),
        );
      }
      samples.push({ elapsedMs: Date.now() - start, ...(await state(page)) });
      lastPixels = await page.screenshot();
      const initial = samples[0],
        final = samples.at(-1);
      assert.ok(
        final.frame >= samples.at(-2).frame,
        "Renderer restarted at final sample",
      );
      assert.equal(
        final.contextRequests,
        initial.contextRequests,
        "Document or graphics context changed at final sample",
      );
      const fps =
        (final.frame - initial.frame) /
        ((final.elapsedMs - initial.elapsedMs) / 1000);
      metrics.push({
        stability: {
          requestedMs: longRunMs,
          samples,
          averageFPS: fps,
          emulatedSoftwareGPU: true,
        },
      });
      assert.ok(fps <= 33, `Unexpected frame rate ${fps}`);
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
      `${width}×${height} touch layout layers mist over content and resizes cleanly`,
      async () => {
        await running(phone);
        await noOverflow(phone);
        if (name === "iphone") await unchangedLayout(phone, "mobile");
        await layeredComparison(phone, `mobile-${name}-top`);
        await screenshot(phone, `homepage-${name}`);
        await phone.locator(".home-featured").scrollIntoViewIfNeeded();
        await phone.waitForTimeout(650);
        await layeredComparison(phone, `mobile-${name}-scrolled`);
        await continuousScroll(phone, `mobile-${name}`);
        await screenshot(phone, `homepage-${name}-scrolled`);
        await phone.evaluate(() => scrollTo(0, 0));
        const menu = phone.getByRole("button", { name: "Open navigation" });
        if (await menu.isVisible()) {
          await menu.tap();
          await expect(
            phone.getByRole("navigation", { name: "Main navigation" }),
          ).toBeVisible();
          await expect(phone.locator(fog)).toHaveCSS("opacity", "0");
          await expect(phone.locator(fog)).toHaveAttribute(
            "data-status",
            "paused-menu",
          );
          const menuFrame = await state(phone);
          await phone.waitForTimeout(250);
          assert.equal((await state(phone)).frame, menuFrame.frame);
          await phone.getByRole("button", { name: "Close navigation" }).tap();
          await expect(phone.locator(fog)).toHaveCSS("opacity", "1");
          await running(phone);
          assert.ok((await state(phone)).frame > menuFrame.frame);
        }
        await phone.setViewportSize({ width: height, height: width });
        await phone.waitForTimeout(650);
        await noOverflow(phone);
        await running(phone);
        const s = await state(phone);
        assert.ok(
          s.rootRect.left < 0 &&
            s.rootRect.right > height &&
            s.rootRect.top < 0 &&
            s.rootRect.bottom > width,
          JSON.stringify(s),
        );
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
