import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Run the actual deployed policy independently from the generated bundle.
const source = readFileSync(
  "deploy/midnight-preview/worker.mjs",
  "utf8",
).replace(
  'import application from "../../dist/phasm/index.js";',
  `const application = { async fetch(request, env) {
    if (new URL(request.url).pathname === "/robots.txt") return new Response("User-agent: *\\nAllow: /\\nSitemap: https://phasm.example/sitemap.xml\\n");
    return new Response(JSON.stringify({bindings: Object.keys(env)}), {headers: {"Content-Type": "text/html", "Cache-Control": "public, max-age=60"}});
  } };`,
);
const wrapper = (
  await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  )
).default;
const env = {
  DB: {},
  ASSETS: {},
  SITE_URL: "https://phasm.example",
  ADMIN_TOKEN: "must-not-forward",
  EXTRA_BINDING: {},
};

test("published wrapper permits crawlable public responses and forwards the real robots policy", async () => {
  for (const path of [
    "/",
    "/map",
    "/haunted-places/colorado",
    "/sitemap.xml",
  ]) {
    const response = await wrapper.fetch(
      new Request(`https://phasm.example${path}`),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Robots-Tag"), null);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    assert.deepEqual((await response.json()).bindings, [
      "DB",
      "ASSETS",
      "SITE_URL",
    ]);
  }
  const robots = await wrapper.fetch(
    new Request("https://phasm.example/robots.txt"),
    env,
  );
  assert.match(await robots.text(), /Allow: \/\nSitemap:/);
  const head = await wrapper.fetch(
    new Request("https://phasm.example/", { method: "HEAD" }),
    env,
  );
  assert.equal(await head.text(), "");
});

test("publication still blocks administration, development routes and all writes", async () => {
  for (const path of [
    "/admin",
    "/api/admin/review/meta",
    "/%61dmin",
    "/%2561dmin",
    "/worker/index.ts",
    "/src/main.tsx",
    "/assets/app.js.map",
    "/.env",
    "/@vite/client",
    "/cdn-cgi/explorer",
  ]) {
    const response = await wrapper.fetch(
      new Request(`https://phasm.example${path}`),
      env,
    );
    assert.equal(response.status, 404, path);
    assert.equal(
      response.headers.get("X-Robots-Tag"),
      "noindex, nofollow",
      path,
    );
  }
  for (const [path, status] of [
    ["/api/reviews", 403],
    ["/api/locations", 405],
    ["/", 405],
  ] as const) {
    const response = await wrapper.fetch(
      new Request(`https://phasm.example${path}`, { method: "POST" }),
      env,
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  }
});
