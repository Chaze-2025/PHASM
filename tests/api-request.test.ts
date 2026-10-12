import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api-request";

const response = (
  data: unknown,
  control = "public, max-age=30",
  status = 200,
) => Response.json(data, { status, headers: { "Cache-Control": control } });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

test("anonymous catalog requests share in-flight work and honor independent cancellation", async () => {
  const result = deferred();
  const calls: RequestInit[] = [];
  const client = createApiClient({
    fetcher: (async (_url, init) => {
      calls.push(init!);
      return result.promise;
    }) as typeof fetch,
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = client.request("/api/locations?pageSize=24&format=summary", {
    signal: a.signal,
  });
  const second = client.request("/api/locations?format=summary&pageSize=24", {
    signal: b.signal,
  });
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].cache, "no-cache");
  assert.equal(calls[0].signal?.aborted, false);
  result.resolve(response({ total: 136 }));
  assert.deepEqual(await second, { total: 136 });
  assert.deepEqual(
    await client.request("/api/locations?pageSize=24&format=summary"),
    { total: 136 },
  );
  assert.equal(calls.length, 1);
});

test("last subscriber cancellation aborts unused fetches and stale completion cannot refill cache", async () => {
  const requests: {
    result: ReturnType<typeof deferred>;
    signal: AbortSignal;
  }[] = [];
  const client = createApiClient({
    fetcher: (async (_url, init) => {
      const result = deferred();
      requests.push({ result, signal: init!.signal! });
      return result.promise;
    }) as typeof fetch,
  });
  const controller = new AbortController();
  const old = client.request("/api/meta", { signal: controller.signal });
  controller.abort();
  await assert.rejects(old, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(requests[0].signal.aborted, true);
  const current = client.request("/api/meta");
  requests[1].result.resolve(response({ total: 136 }));
  assert.deepEqual(await current, { total: 136 });
  requests[0].result.resolve(response({ total: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(await client.request("/api/meta"), { total: 136 });
  assert.equal(requests.length, 2);
});

test("same-turn resubscription reuses fetch; already-aborted requests never start", async () => {
  const result = deferred();
  let calls = 0;
  let signal: AbortSignal;
  const client = createApiClient({
    fetcher: (async (_url, init) => {
      calls++;
      signal = init!.signal!;
      return result.promise;
    }) as typeof fetch,
  });
  const controller = new AbortController();
  const old = client.request("/api/meta", { signal: controller.signal });
  controller.abort();
  const current = client.request("/api/meta");
  await assert.rejects(old, { name: "AbortError" });
  await assert.rejects(
    client.request("/api/locations", { signal: controller.signal }),
    { name: "AbortError" },
  );
  result.resolve(response({ total: 136 }));
  await current;
  assert.equal(calls, 1);
  assert.equal(signal!.aborted, false);
});

test("public cache expires after 30 seconds and evicts least recently used entries", async () => {
  let now = 0,
    calls = 0;
  const client = createApiClient({
    now: () => now,
    maxEntries: 2,
    fetcher: (async () =>
      response({ version: ++calls }, "public, max-age=3600")) as typeof fetch,
  });
  await client.request("/api/meta");
  await client.request("/api/locations?page=1");
  assert.deepEqual(await client.request("/api/meta"), { version: 1 });
  await client.request("/api/locations?page=2");
  await client.request("/api/locations?page=1");
  assert.equal(calls, 4);
  now = 29_999;
  assert.deepEqual(await client.request("/api/locations?page=1"), {
    version: 4,
  });
  now = 30_000;
  assert.deepEqual(await client.request("/api/locations?page=1"), {
    version: 5,
  });
});

test("failed, private, no-store, no-cache and uncacheable responses are never retained", async () => {
  for (const control of [
    "private, max-age=30",
    "no-store",
    "no-cache, max-age=30",
    "",
    "max-age=0",
  ]) {
    let calls = 0;
    const client = createApiClient({
      fetcher: (async () =>
        response({ calls: ++calls }, control)) as typeof fetch,
    });
    await client.request("/api/meta");
    await client.request("/api/meta");
    assert.equal(calls, 2, control);
  }
  let calls = 0;
  const client = createApiClient({
    fetcher: (async () =>
      ++calls === 1
        ? response({ error: "Try again" }, "public, max-age=30", 503)
        : response({ total: 136 })) as typeof fetch,
  });
  await assert.rejects(client.request("/api/meta"), /Try again/);
  assert.deepEqual(await client.request("/api/meta"), { total: 136 });
  assert.equal(calls, 2);
});

test("admin, personal, authenticated and explicit uncached requests bypass sharing and storage", async () => {
  for (const [path, init] of [
    ["/api/admin/locations", undefined],
    ["/api/account", undefined],
    ["https://other.example/api/meta", undefined],
    ["/api/meta", { headers: { Authorization: "Bearer secret" } }],
    ["/api/meta", { credentials: "include" }],
    ["/api/meta", { cache: "no-store" }],
    ["/api/meta", { redirect: "error" }],
    ["/api/meta", { method: "HEAD" }],
  ] as [string, RequestInit | undefined][]) {
    let calls = 0;
    const client = createApiClient({
      fetcher: (async () => response({ call: ++calls })) as typeof fetch,
    });
    await Promise.all([client.request(path, init), client.request(path, init)]);
    await client.request(path, init);
    assert.equal(calls, 3, path);
  }
});

test("successful mutations clear public data and detach older in-flight results", async () => {
  let metaCalls = 0;
  const old = deferred();
  const current = deferred();
  let locationCalls = 0;
  const client = createApiClient({
    fetcher: (async (path) => {
      if (path === "/api/locations")
        return ++locationCalls === 1 ? old.promise : current.promise;
      if (path === "/api/meta") return response({ revision: ++metaCalls });
      return response({ saved: true }, "no-store");
    }) as typeof fetch,
  });
  await client.request("/api/meta");
  const oldLocations = client.request("/api/locations");
  await client.request("/api/admin/locations/test", {
    method: "PUT",
    body: "{}",
  });
  assert.deepEqual(await client.request("/api/meta"), { revision: 2 });
  const currentLocations = client.request("/api/locations");
  old.resolve(response({ revision: 1 }));
  await oldLocations;
  const sharedCurrentLocations = client.request("/api/locations");
  assert.equal(locationCalls, 2);
  current.resolve(response({ revision: 2 }));
  assert.deepEqual(await currentLocations, { revision: 2 });
  assert.deepEqual(await sharedCurrentLocations, { revision: 2 });
  assert.deepEqual(await client.request("/api/locations"), { revision: 2 });
  assert.equal(locationCalls, 2);
  client.clear();
  assert.deepEqual(await client.request("/api/meta"), { revision: 3 });
});
