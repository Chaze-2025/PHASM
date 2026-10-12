/** Read-only, repeatable browser performance probe. Writes reports/screenshots only.
 * PHASM_BASE_URL, PHASM_PERF_OUTPUT; optional PHASM_PERF_SCENARIOS=map|home.
 * Software WebGL and proxy timings are environment observations, not device benchmarks.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base =
  process.env.PHASM_BASE_URL ||
  "https://phasm-phase-1-3-preview.wj7djnw2j2.workers.dev";
const out =
  process.env.PHASM_PERF_OUTPUT || "/workspace/phasm-performance/before";
await mkdir(out, { recursive: true });
const selectedScenarios = process.env.PHASM_PERF_SCENARIOS || "all";
const startedAt = new Date().toISOString();
const report = {
  startedAt,
  source: base,
  environment: {
    browser: "Playwright Chromium headless with SwiftShader",
    cpuThrottle: "none",
    networkThrottle: "none",
    outboundProxy: Boolean(process.env.HTTPS_PROXY),
    limitations:
      "One cold/warm sample per scenario; software GPU and managed outbound proxy are not physical device performance. Interaction elapsed includes Playwright dispatch and API completion; frame intervals measure main-thread rAF cadence, not GPU presentation.",
  },
  scenarios: [],
  errors: [],
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
const summaryFile = `${out}/report.json`;
const save = () => writeFile(summaryFile, JSON.stringify(report, null, 2));
const percentile = (a, q) =>
  a.length
    ? [...a].sort((x, y) => x - y)[
        Math.min(a.length - 1, Math.floor(a.length * q))
      ]
    : null;
const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
function networkSummary(records) {
  const groups = {};
  for (const r of records) {
    const u = new URL(r.url),
      category =
        u.origin === new URL(base).origin
          ? u.pathname.startsWith("/api/atlas")
            ? "atlas-api"
            : u.pathname.startsWith("/api/locations")
              ? "locations-api"
              : u.pathname.startsWith("/api/")
                ? "other-api"
                : r.type === "Image"
                  ? "site-images"
                  : r.type
          : u.hostname;
    const g = (groups[category] ||= {
      requests: 0,
      complete: 0,
      aborted: 0,
      transferredBytes: 0,
      cached: 0,
    });
    g.requests++;
    g.complete += Boolean(r.end);
    g.aborted += Boolean(r.failure);
    g.transferredBytes += r.encodedBytes || 0;
    g.cached += Boolean(r.cached);
  }
  return {
    requests: records.length,
    transferredBytes: records.reduce((n, r) => n + (r.encodedBytes || 0), 0),
    cached: records.filter((r) => r.cached).length,
    failures: records
      .filter((r) => r.failure)
      .map((r) => ({ url: r.url, failure: r.failure })),
    groups,
    api: records
      .filter((r) => new URL(r.url).pathname.startsWith("/api/"))
      .map((r) => ({
        path: new URL(r.url).pathname + new URL(r.url).search,
        durationMs: round(r.end ? r.end - r.start : null),
        ttfbMs: round(
          r.serverTiming?.receiveHeadersEnd >= 0
            ? r.serverTiming.receiveHeadersEnd
            : null,
        ),
        transferredBytes: r.encodedBytes || 0,
        decodedBytes: r.decodedBytes || 0,
        status: r.status,
        failure: r.failure,
        atlas: r.atlas,
      })),
    largest: [...records]
      .sort((a, b) => (b.encodedBytes || 0) - (a.encodedBytes || 0))
      .slice(0, 8)
      .map((r) => ({
        url: r.url,
        bytes: r.encodedBytes || 0,
        durationMs: round(r.end ? r.end - r.start : null),
        cached: r.cached || false,
      })),
  };
}
async function setup(label, mobile, reducedMotion) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript(() => {
    const p = (window.__phasmPerf = {
      longTasks: [],
      events: [],
      paints: [],
      lcp: [],
      frames: [],
      contexts: [],
      mutations: [],
    });
    const observe = (type, cb, options = {}) => {
      if (PerformanceObserver.supportedEntryTypes.includes(type))
        new PerformanceObserver((list) =>
          list.getEntries().forEach(cb),
        ).observe({ type, buffered: true, ...options });
    };
    observe("longtask", (e) =>
      p.longTasks.push({ start: e.startTime, duration: e.duration }),
    );
    observe(
      "event",
      (e) =>
        p.events.push({
          name: e.name,
          start: e.startTime,
          duration: e.duration,
          processingStart: e.processingStart,
          processingEnd: e.processingEnd,
          interactionId: e.interactionId,
        }),
      { durationThreshold: 16 },
    );
    observe("paint", (e) =>
      p.paints.push({ name: e.name, start: e.startTime }),
    );
    observe("largest-contentful-paint", (e) =>
      p.lcp.push({
        start: e.startTime,
        size: e.size,
        url: e.url,
        element: e.element?.className || e.element?.tagName,
      }),
    );
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const c = original.call(this, kind, ...args);
      if (String(kind).includes("webgl"))
        p.contexts.push({
          kind,
          at: performance.now(),
          className: this.className,
          success: Boolean(c),
        });
      return c;
    };
    function frame(t) {
      p.frames.push(t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(".map-status");
      if (el && p.mutations.at(-1)?.text !== el.textContent)
        p.mutations.push({ at: performance.now(), text: el.textContent });
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", (error) =>
    report.errors.push({ label, error: error.message }),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  const records = new Map();
  let activePhase = "";
  cdp.on("Network.requestWillBeSent", (e) =>
    records.set(e.requestId, {
      id: e.requestId,
      phase: activePhase,
      url: e.request.url,
      method: e.request.method,
      start: e.timestamp * 1000,
      type: e.type,
    }),
  );
  cdp.on("Network.responseReceived", (e) => {
    const r = records.get(e.requestId);
    if (r)
      Object.assign(r, {
        responseAt: e.timestamp * 1000,
        status: e.response.status,
        mime: e.response.mimeType,
        cached:
          e.response.fromDiskCache || e.response.fromPrefetchCache || false,
        serverTiming: e.response.timing,
      });
  });
  cdp.on("Network.requestServedFromCache", (e) => {
    const r = records.get(e.requestId);
    if (r) r.cached = true;
  });
  cdp.on("Network.dataReceived", (e) => {
    const r = records.get(e.requestId);
    if (r) r.decodedBytes = (r.decodedBytes || 0) + e.dataLength;
  });
  cdp.on("Network.loadingFinished", async (e) => {
    const r = records.get(e.requestId);
    if (r) {
      Object.assign(r, {
        end: e.timestamp * 1000,
        encodedBytes: e.encodedDataLength,
      });
      if (new URL(r.url).pathname === "/api/atlas") {
        try {
          const body = await cdp.send("Network.getResponseBody", {
            requestId: e.requestId,
          });
          const a = JSON.parse(
            body.base64Encoded
              ? Buffer.from(body.body, "base64").toString()
              : body.body,
          );
          r.atlas = {
            total: a.total,
            features: a.features?.length,
            clustered: a.features?.filter((f) => f.properties?.clustered)
              .length,
            allNumeric: a.features?.every((f) =>
              f.geometry?.coordinates?.every(Number.isFinite),
            ),
            representedPins: a.features?.reduce(
              (n, f) => n + (f.properties?.count || 1),
              0,
            ),
          };
        } catch {}
      }
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    const r = records.get(e.requestId);
    if (r)
      Object.assign(r, {
        end: e.timestamp * 1000,
        failure: e.errorText,
        cancelled: e.canceled,
      });
  });
  const scenario = {
    label,
    mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion,
    phases: [],
  };
  report.scenarios.push(scenario);
  async function metrics() {
    return Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  }
  async function phase(
    name,
    action,
    { navigation = false, idleMs = 600, screenshot = false } = {},
  ) {
    activePhase = name;
    const wallStart = Date.now(),
      counters = await metrics();
    const start = navigation ? 0 : await page.evaluate(() => performance.now());
    let error, milestone;
    try {
      milestone = await action();
    } catch (e) {
      error = e.message;
    }
    const readyWallMs = Date.now() - wallStart;
    await page.waitForTimeout(idleMs);
    const data = await page.evaluate((start) => {
      const p = window.__phasmPerf,
        frames = p.frames.filter((t) => t >= start),
        now = performance.now(),
        c = document.querySelector(".atmospheric-fog-canvas"),
        m = document.querySelector(".maplibregl-canvas");
      return {
        now,
        frames,
        longTasks: p.longTasks.filter((t) => t.start >= start),
        events: p.events.filter((t) => t.start >= start),
        paints: p.paints,
        lcp: p.lcp.at(-1),
        navigation: performance.getEntriesByType("navigation")[0]?.toJSON(),
        contexts: p.contexts,
        statuses: p.mutations.filter((m) => m.at >= start),
        fog: {
          status: document.querySelector(".atmospheric-fog")?.dataset.status,
          frame: Number(c?.dataset.frame || 0),
          quality: document.querySelector(".atmospheric-fog")?.dataset.quality,
          resolution: c?.dataset.resolution,
        },
        mapCanvas: m
          ? {
              width: m.width,
              height: m.height,
              cssWidth: m.clientWidth,
              cssHeight: m.clientHeight,
            }
          : null,
        images: [...document.images].map((i) => ({
          src: i.currentSrc,
          complete: i.complete,
          width: i.naturalWidth,
          loading: i.loading,
        })),
        resources: performance
          .getEntriesByType("resource")
          .map((e) => ({
            name: e.name,
            start: e.startTime,
            duration: e.duration,
            transfer: e.transferSize,
            decoded: e.decodedBodySize,
            initiatorType: e.initiatorType,
          })),
      };
    }, start);
    const endCounters = await metrics();
    const frames = data.frames.slice(1).map((t, i) => t - data.frames[i]);
    const entry = {
      name,
      error,
      wallMs: Date.now() - wallStart,
      readyWallMs,
      measuredWindowMs: round(data.now - start),
      milestone,
      frameCadence: {
        intervals: frames.length,
        fps: frames.length
          ? round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length))
          : null,
        p50Ms: round(percentile(frames, 0.5)),
        p95Ms: round(percentile(frames, 0.95)),
        maxMs: round(Math.max(0, ...frames)),
        over50ms: frames.filter((f) => f > 50).length,
      },
      longTasks: {
        count: data.longTasks.length,
        totalMs: round(data.longTasks.reduce((n, e) => n + e.duration, 0)),
        blockingMs: round(
          data.longTasks.reduce((n, e) => n + Math.max(0, e.duration - 50), 0),
        ),
        maxMs: round(Math.max(0, ...data.longTasks.map((e) => e.duration))),
        entries: data.longTasks,
      },
      events: data.events,
      cpu: Object.fromEntries(
        [
          "TaskDuration",
          "ScriptDuration",
          "LayoutDuration",
          "RecalcStyleDuration",
        ].map((k) => [
          k + "Ms",
          round((endCounters[k] - (navigation ? 0 : counters[k])) * 1000),
        ]),
      ),
      heapBytes: endCounters.JSHeapUsedSize,
      domNodes: endCounters.Nodes,
      network: networkSummary(
        [...records.values()].filter((r) => r.phase === name),
      ),
      paints: navigation ? data.paints : undefined,
      lcp: navigation ? data.lcp : undefined,
      navigation: navigation ? data.navigation : undefined,
      contexts: data.contexts,
      statuses: data.statuses,
      fog: data.fog,
      mapCanvas: data.mapCanvas,
      resources: navigation ? data.resources : undefined,
    };
    scenario.phases.push(entry);
    await save();
    console.log(
      JSON.stringify({
        label,
        name,
        readyWallMs,
        requests: entry.network.requests,
        bytes: entry.network.transferredBytes,
        longTasks: entry.longTasks.count,
        blockingMs: entry.longTasks.blockingMs,
        fps: entry.frameCadence.fps,
        error,
      }),
    );
    if (screenshot)
      await page.screenshot({ path: `${out}/${label}-${name}.png` });
    return entry;
  }
  async function finish() {
    await writeFile(
      `${out}/${label}-network.json`,
      JSON.stringify([...records.values()], null, 2),
    );
    await context.close();
  }
  return { page, phase, finish };
}
async function twoFrames(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now())),
        ),
      ),
  );
}
async function mapReady(page) {
  await expect(page.locator(".map-status")).toContainText(
    /mapped places? in this area|No mapped places in this area/,
    { timeout: 60000 },
  );
  await expect(
    page.locator(".atlas-card-list .card-title").first(),
  ).toBeAttached();
  return {
    readyAtMs: await twoFrames(page),
    status: await page.locator(".map-status").innerText(),
  };
}
async function homeReady(page, reduced) {
  await expect(page.locator(".home-hero-image")).toBeVisible();
  await page.locator(".home-hero-image").evaluate((i) => i.decode());
  await expect(page.locator(".location-card")).toHaveCount(3);
  await expect(page.locator(".atmospheric-fog")).toHaveAttribute(
    "data-status",
    reduced ? "reduced-motion" : "running",
  );
  return { readyAtMs: await twoFrames(page) };
}
try {
  for (const mobile of selectedScenarios === "home" ? [] : [false, true]) {
    const label = mobile ? "mobile-map" : "desktop-map";
    const { page, phase, finish } = await setup(label, mobile, false);
    await phase(
      "cold-load",
      async () => {
        await page.goto(base + "/map", { waitUntil: "domcontentloaded" });
        return mapReady(page);
      },
      { navigation: true, idleMs: 1500, screenshot: true },
    );
    await phase(
      "warm-load",
      async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        return mapReady(page);
      },
      { navigation: true, idleMs: 1500 },
    );
    await phase("idle", () => page.waitForTimeout(4000), { idleMs: 0 });
    await phase(
      "pan",
      async () => {
        const r = await page.locator(".maplibregl-canvas").boundingBox();
        await page.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.52);
        await page.mouse.down();
        await page.mouse.move(r.x + r.width * 0.67, r.y + r.height * 0.56, {
          steps: 24,
        });
        await page.mouse.up();
        await page.waitForTimeout(1000);
        return { readyAtMs: await twoFrames(page) };
      },
      { idleMs: 1000 },
    );
    await phase(
      "zoom",
      async () => {
        await page
          .getByRole("button", { name: "Zoom in", exact: true })
          .click();
        await page.waitForTimeout(600);
        return { readyAtMs: await twoFrames(page) };
      },
      { idleMs: 1200 },
    );
    await phase(
      "region-route",
      async () => {
        await page.goto(base + "/map?region=North%20America", {
          waitUntil: "domcontentloaded",
        });
        return mapReady(page);
      },
      { navigation: true, idleMs: 1200 },
    );
    if (!mobile)
      await phase(
        "pagination",
        async () => {
          await page.getByRole("button", { name: "Next", exact: true }).click();
          await expect(page.locator(".pagination")).toContainText("Page 2 of");
          return { readyAtMs: await twoFrames(page) };
        },
        { idleMs: 1200 },
      );
    await page.locator(".filter-toggle").click();
    await page.getByRole("button", { name: "Reset all", exact: true }).click();
    await page.waitForTimeout(700);
    await phase(
      "filter-europe",
      async () => {
        await page
          .getByRole("combobox", { name: "Region", exact: true })
          .selectOption("Europe");
        await expect(page.locator(".atlas-card-list")).not.toContainText(
          "The Stanley Hotel",
        );
        await expect(
          page.locator(".atlas-card-list .card-title").first(),
        ).toBeAttached();
        return {
          readyAtMs: await twoFrames(page),
          heading: await page.locator(".results-heading").innerText(),
        };
      },
      { idleMs: 1800 },
    );
    await page.getByRole("button", { name: "Reset all", exact: true }).click();
    await page
      .getByRole("button", { name: "Close filters", exact: true })
      .click();
    await page.waitForTimeout(1200);
    await page
      .getByRole("textbox", {
        name: "Search location name, city, state or country",
      })
      .fill("Stanley");
    await phase(
      "search-stanley",
      async () => {
        await page
          .getByRole("button", { name: "Search atlas", exact: true })
          .click();
        await expect(page.locator(".atlas-card-list .card-title")).toHaveCount(
          1,
        );
        await expect(page.locator(".atlas-card-list .card-title")).toHaveText(
          "The Stanley Hotel",
        );
        return {
          readyAtMs: await twoFrames(page),
          heading: await page.locator(".results-heading").innerText(),
        };
      },
      { idleMs: 2200 },
    );
    await mapReady(page);
    await page.waitForTimeout(600);
    const markerClick = async (repeat = false) => {
      const r = await page.locator(".maplibregl-canvas").boundingBox();
      await page.mouse.click(
        r.x + r.width / 2,
        r.y + r.height / 2 - (repeat && mobile && r.height < 480 ? 75 : 0),
      );
      await expect(page.locator(".map-preview h2")).toHaveText(
        "The Stanley Hotel",
      );
      return { readyAtMs: await twoFrames(page) };
    };
    await phase("marker-first", () => markerClick(), {
      idleMs: 800,
      screenshot: true,
    });
    await page
      .getByRole("button", { name: "Close location preview", exact: true })
      .click();
    await page.waitForTimeout(700);
    await phase("marker-repeat", () => markerClick(true), { idleMs: 500 });
    await phase(
      "list-only-route",
      async () => {
        await page.goto(base + "/map?view=list", {
          waitUntil: "domcontentloaded",
        });
        await expect(
          page.locator(".atlas-card-list .card-title").first(),
        ).toBeVisible();
        return { readyAtMs: await twoFrames(page) };
      },
      { navigation: true, idleMs: 1500 },
    );
    await finish();
  }
  for (const mobile of selectedScenarios === "map" ? [] : [false, true]) {
    const reduced = false;
    const label = `${mobile ? "mobile" : "desktop"}-home-${reduced ? "reduced" : "normal"}`;
    const { page, phase, finish } = await setup(label, mobile, reduced);
    await phase(
      "cold-load",
      async () => {
        await page.goto(base, { waitUntil: "domcontentloaded" });
        return homeReady(page, reduced);
      },
      { navigation: true, idleMs: 1500, screenshot: true },
    );
    await phase("idle", () => page.waitForTimeout(4000), { idleMs: 0 });
    await phase(
      "scroll",
      async () => {
        await page.evaluate(async () => {
          const target = document.querySelector(
            ".home-atlas-section",
          ).offsetTop;
          for (let i = 0; i <= 28; i++) {
            scrollTo(0, (target * i) / 28);
            await new Promise((r) => setTimeout(r, 45));
          }
        });
        return { readyAtMs: await twoFrames(page) };
      },
      { idleMs: 700, screenshot: true },
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(500);
    await phase("reduced-idle", () => page.waitForTimeout(3000), { idleMs: 0 });
    await phase(
      "reduced-scroll",
      async () => {
        await page.evaluate(async () => {
          const target = document.querySelector(
            ".home-atlas-section",
          ).offsetTop;
          for (let i = 0; i <= 28; i++) {
            scrollTo(0, (target * i) / 28);
            await new Promise((r) => setTimeout(r, 45));
          }
        });
        return { readyAtMs: await twoFrames(page) };
      },
      { idleMs: 700 },
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await phase(
      "route-map",
      async () => {
        await page.locator(".home-atlas-copy a").click();
        return mapReady(page);
      },
      { idleMs: 1000 },
    );
    await phase(
      "route-home-warm",
      async () => {
        await page.evaluate(() => scrollTo(0, 0));
        const nav = page.getByRole("button", { name: "Open navigation" });
        if (await nav.isVisible()) await nav.click();
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Discover", exact: true })
          .click();
        return homeReady(page, reduced);
      },
      { idleMs: 1000 },
    );
    await finish();
  }
} catch (e) {
  report.errors.push({ fatal: e.stack });
  console.error(e);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await save();
}
if (
  report.errors.length ||
  report.scenarios.some((s) => s.phases.some((p) => p.error))
)
  process.exitCode = 1;
console.log(`Probe saved ${summaryFile}`);
