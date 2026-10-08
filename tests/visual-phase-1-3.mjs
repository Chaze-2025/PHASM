/** Supplemental Phase 1.3 checks. Run against a seeded local or read-only preview.
 * PHASM_BASE_URL defaults to localhost:5175. Artifact directory is configurable.
 * Chromium touch emulation is not physical iPhone or Safari testing.
 */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.PHASM_BASE_URL || "http://localhost:5175";
const output =
  process.env.PHASM_SCREENSHOT_DIR || "/workspace/scratch/phase-1-3-qa";
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
  a11yResults = [],
  measurements = [];
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
async function noOverflow(page) {
  const v = await page.evaluate(() => ({
    viewport: innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    v.body <= v.viewport + 1 && v.document <= v.viewport + 1,
    JSON.stringify(v),
  );
}
async function mobileFormFont(page) {
  const fields = await page
    .locator("input:visible,select:visible,textarea:visible")
    .evaluateAll((es) =>
      es.map((e) => ({
        label: e.getAttribute("aria-label") || e.name,
        size: parseFloat(getComputedStyle(e).fontSize),
      })),
    );
  assert.deepEqual(
    fields.filter((e) => e.size < 16),
    [],
    "Touch form text must be at least 16px to avoid Safari focus zoom.",
  );
}
async function tapTargets(page, selector) {
  const measures = await page.locator(selector).evaluateAll((es) =>
    es
      .filter((e) => e.getClientRects().length)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return {
          name: e.getAttribute("aria-label") || e.textContent.trim(),
          width: r.width,
          height: r.height,
        };
      }),
  );
  measurements.push(...measures);
  assert.deepEqual(
    measures.filter((e) => e.width < 43.5 || e.height < 43.5),
    [],
  );
}
async function scan(page, label) {
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  a11yResults.push({ label, violations: audit.violations });
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    [],
  );
}
async function motionDisabled(page) {
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
  );
  const moving = await page.locator("main *").evaluateAll((es) =>
    es
      .filter((e) => e.getClientRects().length)
      .filter((e) => {
        const s = getComputedStyle(e);
        return (
          s.animationName !== "none" ||
          s.transitionDuration.split(",").some((t) => parseFloat(t) > 0)
        );
      })
      .map((e) => ({ tag: e.tagName, classes: e.className })),
  );
  assert.deepEqual(moving, []);
}
try {
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await check(
      `${width}px homepage, navigation, form size and motion`,
      async () => {
        await page.goto(baseURL, { waitUntil: "networkidle" });
        await noOverflow(page);
        await mobileFormFont(page);
        await motionDisabled(page);
        await tapTargets(
          page,
          ".home-search button,.home-atlas-link,.menu-button,.header-actions > a",
        );
        await page.getByRole("button", { name: "Open navigation" }).click();
        await expect(
          page.getByRole("navigation", { name: "Main navigation" }),
        ).toBeVisible();
        await noOverflow(page);
        await page.getByRole("button", { name: "Close navigation" }).click();
      },
    );
    await check(
      `${width}px atlas, filters, map/list and touch targets`,
      async () => {
        await page.goto(`${baseURL}/map`, { waitUntil: "networkidle" });
        await expect(page.locator(".map-status")).toContainText(
          /places in this area/,
          { timeout: 60000 },
        );
        await noOverflow(page);
        await mobileFormFont(page);
        await tapTargets(
          page,
          ".atlas-search button,.filter-toggle,.view-switch button,.map-reset,.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out",
        );
        const bounds = await page.locator(".maplibregl-canvas").boundingBox();
        assert.ok(bounds && bounds.height >= 350);
        assert.ok(bounds.y + bounds.height <= 846, JSON.stringify(bounds));
        await page
          .getByRole("button", { name: "Filters", exact: true })
          .click();
        await mobileFormFont(page);
        await noOverflow(page);
        await page
          .getByRole("combobox", { name: "Region", exact: true })
          .selectOption("Europe");
        await page
          .getByRole("button", { name: "Show places", exact: true })
          .click();
        await expect(page.locator(".filter-panel")).toHaveCount(0);
        await page
          .getByRole("button", { name: "List view", exact: true })
          .click();
        await expect(
          page.locator(".atlas-card-list .card-title").first(),
        ).toBeVisible();
        await noOverflow(page);
        assert.ok(
          !(await page.locator(".atlas-card-list").innerText()).includes(
            "The Stanley Hotel",
          ),
        );
      },
    );
    await check(
      `${width}px Stanley profile reading width, jump navigation and imagery`,
      async () => {
        await page.goto(`${baseURL}/locations/stanley-hotel`, {
          waitUntil: "networkidle",
        });
        await noOverflow(page);
        await motionDisabled(page);
        const reading = await page
          .locator("#history > p, #reports > p")
          .evaluateAll((es) =>
            es.map((e) => parseFloat(getComputedStyle(e).fontSize)),
          );
        assert.ok(reading.length > 0);
        assert.ok(
          reading.every((s) => s >= 16),
          JSON.stringify(reading),
        );
        await expect(page.locator("#history")).toBeVisible();
        await expect(
          page.locator('.dossier-reading-key a[href="#history"]'),
        ).toContainText("Documented history");
        await expect(
          page.locator('.dossier-reading-key a[href="#reports"]'),
        ).toContainText("Reported hauntings");
        await expect(page.locator("#reports h2")).toHaveText("The Hauntings");
        await expect(page.locator("#history h2")).toHaveText("The History");
        await expect(
          page.locator("#reports .dossier-report-narrative"),
        ).not.toBeEmpty();
        await expect(page.locator(".gallery-treatment")).toContainText(
          "Contemporary location photography",
        );
        await expect(page.locator(".gallery-original")).toHaveAttribute(
          "href",
          /^https:\/\//,
        );
        await expect(
          page.locator("#sources .source-list li").first(),
        ).toBeVisible();
        const localLinks = await page
          .locator('a[href^="#"]')
          .evaluateAll((es) =>
            es
              .map((e) => e.getAttribute("href"))
              .filter((h) => h.length > 1)
              .filter(
                (h) => !document.getElementById(decodeURIComponent(h.slice(1))),
              ),
          );
        assert.deepEqual(localLinks, []);
        const photos = page.locator("img");
        for (let i = 0; i < (await photos.count()); i++) {
          await photos.nth(i).scrollIntoViewIfNeeded();
          await expect(photos.nth(i)).toHaveJSProperty("complete", true);
          assert.ok(await photos.nth(i).evaluate((e) => e.naturalWidth > 0));
        }
        await page.evaluate(() => scrollTo(0, 0));
      },
    );
    if (width === 390) {
      for (const [label, path] of [
        ["mobile map", "/map"],
        ["mobile profile", "/locations/stanley-hotel"],
      ])
        await check(`${label} touch-emulated WCAG scan`, async () => {
          await page.goto(baseURL + path, { waitUntil: "networkidle" });
          await scan(page, label);
        });
      await check(
        "Touch marker preview stays within viewport; map drag does not scroll page",
        async () => {
          await page.goto(`${baseURL}/map?q=Stanley`, {
            waitUntil: "networkidle",
          });
          await expect(page.locator(".map-status")).toContainText(
            /1 place in this area/,
            { timeout: 60000 },
          );
          const b = await page.locator(".maplibregl-canvas").boundingBox();
          assert.ok(b);
          const x = b.x + b.width / 2,
            y = b.y + b.height / 2;
          await page.touchscreen.tap(x, y);
          await expect(page.locator(".map-preview h2")).toHaveText(
            "The Stanley Hotel",
          );
          const p = await page.locator(".map-preview").boundingBox();
          assert.ok(
            p &&
              p.x >= 0 &&
              p.x + p.width <= 391 &&
              p.y >= 0 &&
              p.y + p.height <= 845,
            JSON.stringify(p),
          );
          await tapTargets(page, ".preview-close,.map-preview .button");
          await page
            .getByRole("button", { name: "Close location preview" })
            .click();
          const scroll = await page.evaluate(() => scrollY);
          const request = page.waitForResponse(
            (r) => r.url().includes("/api/atlas?") && r.status() === 200,
          );
          const session = await context.newCDPSession(page);
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 1 }],
          });
          for (let step = 1; step <= 5; step++)
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: x + step * 12, y: y - step * 4, id: 1 }],
            });
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await request;
          assert.equal(await page.evaluate(() => scrollY), scroll);
          await noOverflow(page);
        },
      );
    }
    await context.close();
  }
  const navigationContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const navigationPage = await navigationContext.newPage();
  navigationPage.on("pageerror", (error) => errors.push(error.message));
  await check(
    "Archival photographs carry provenance, load completely and distinguish staged imagery from location reports",
    async () => {
      await navigationPage.goto(baseURL, { waitUntil: "networkidle" });
      await expect(
        navigationPage.locator(".home-archive-context"),
      ).toContainText("staged historical spirit photograph");
      await expect(
        navigationPage.locator(".home-archive-context"),
      ).toContainText("superimposed figure");
      await expect(
        navigationPage.locator(".home-archive-context"),
      ).toContainText("does not depict an atlas location");
      await expect(
        navigationPage.locator(".home-archive-photograph figcaption"),
      ).toContainText("William H. Mumler");
      await expect(
        navigationPage.locator(
          '.home-archive-photograph figcaption a[href^="https://www.getty.edu/"]',
        ),
      ).toHaveCount(1);
      await expect(
        navigationPage.locator(
          '.home-archive-photograph figcaption a[href="https://creativecommons.org/publicdomain/zero/1.0/"]',
        ),
      ).toHaveCount(1);
      await expect(
        navigationPage
          .locator('.home-story-excerpt a[href="/locations/stanley-hotel"]')
          .last(),
      ).toBeVisible();
      await expect(navigationPage.locator(".home-story-excerpt")).toContainText(
        "According to The Stanley Hotel’s Room 217 lore",
      );
      await expect(
        navigationPage.locator(".home-reading-item .home-planned-label"),
      ).toHaveText(["Planned", "Planned"]);
      const images = navigationPage.locator("main img:visible");
      for (let index = 0; index < (await images.count()); index++) {
        const image = images.nth(index);
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            image.evaluate(
              (element) => element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
        await expect(image).toHaveAttribute("alt", /.+/);
      }
      await navigationPage.evaluate(() => scrollTo(0, 0));
      await noOverflow(navigationPage);
    },
  );
  await check(
    "Mobile menu focuses links and contains forward/backward keyboard focus",
    async () => {
      await navigationPage.goto(baseURL, { waitUntil: "networkidle" });
      for (const opening of ["click", "keyboard"]) {
        const trigger = navigationPage.getByRole("button", {
          name: "Open navigation",
        });
        if (opening === "click") await trigger.click();
        else {
          await trigger.focus();
          await navigationPage.keyboard.press("Enter");
        }
        await expect(
          navigationPage
            .getByRole("navigation", { name: "Main navigation" })
            .getByRole("link")
            .first(),
        ).toBeFocused();
        for (const key of ["Tab", "Shift+Tab"]) {
          for (let step = 0; step < 12; step++) {
            await navigationPage.keyboard.press(key);
            assert.equal(
              await navigationPage.evaluate(() =>
                Boolean(document.activeElement?.closest("header")),
              ),
              true,
              `${opening}: ${key} escaped mobile navigation`,
            );
          }
        }
        await navigationPage.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
    },
  );
  await check(
    "Mobile menu Escape and landscape resize restore page scrolling",
    async () => {
      await navigationPage.goto(baseURL, { waitUntil: "networkidle" });
      await navigationPage
        .getByRole("button", { name: "Open navigation" })
        .click();
      await expect(navigationPage.locator("body")).toHaveCSS(
        "overflow",
        "hidden",
      );
      await navigationPage.keyboard.press("Escape");
      await expect(
        navigationPage.getByRole("button", { name: "Open navigation" }),
      ).toBeFocused();
      await expect
        .poll(() => navigationPage.evaluate(() => document.body.style.overflow))
        .toBe("");
      await navigationPage
        .getByRole("button", { name: "Open navigation" })
        .click();
      await navigationPage.setViewportSize({ width: 844, height: 390 });
      await expect
        .poll(() => navigationPage.evaluate(() => document.body.style.overflow))
        .toBe("");
      await expect(navigationPage.locator(".main-nav")).not.toHaveClass(
        /is-open/,
      );
      await expect(
        navigationPage.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      await noOverflow(navigationPage);
    },
  );
  await navigationContext.close();
  const compactContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const compactPage = await compactContext.newPage();
  compactPage.on("pageerror", (error) => errors.push(error.message));
  await check(
    "375×667 short phone keeps selected preview and zoom controls visible",
    async () => {
      await compactPage.goto(`${baseURL}/map?q=Stanley`, {
        waitUntil: "networkidle",
      });
      await expect(compactPage.locator(".map-status")).toContainText(
        /1 place in this area/,
        { timeout: 60000 },
      );
      const map = await compactPage.locator(".maplibregl-canvas").boundingBox();
      assert.ok(map);
      await compactPage.touchscreen.tap(
        map.x + map.width / 2,
        map.y + map.height / 2,
      );
      await expect(compactPage.locator(".map-preview h2")).toHaveText(
        "The Stanley Hotel",
      );
      for (const selector of [
        ".map-preview",
        ".maplibregl-ctrl-zoom-in",
        ".maplibregl-ctrl-zoom-out",
        ".map-reset",
      ]) {
        const box = await compactPage.locator(selector).boundingBox();
        assert.ok(
          box &&
            box.x >= 0 &&
            box.x + box.width <= 376 &&
            box.y >= 0 &&
            box.y + box.height <= 668,
          `${selector}: ${JSON.stringify(box)}`,
        );
      }
      await noOverflow(compactPage);
    },
  );
  await check(
    "Supporting navigation pages fit a 375px mobile screen",
    async () => {
      for (const route of [
        "/saved",
        "/cases",
        "/account",
        "/encyclopedia",
        "/about",
      ]) {
        await compactPage.goto(baseURL + route, { waitUntil: "networkidle" });
        await expect(compactPage.locator("h1")).toBeVisible();
        await noOverflow(compactPage);
      }
    },
  );
  await compactContext.close();
  await check("No uncaught errors in supplemental mobile review", async () =>
    assert.deepEqual(errors, []),
  );
} finally {
  await browser.close();
  await writeFile(
    `${output}/phase-1-3-mobile-results.json`,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        baseURL,
        emulation: "Chromium touch emulation, not a physical iPhone",
        results,
        errors,
        a11yResults,
        measurements,
      },
      null,
      2,
    ),
  );
}
console.log(
  `${results.filter((r) => r.passed).length}/${results.length} supplemental checks passed.`,
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
