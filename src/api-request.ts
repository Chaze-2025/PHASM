type Cached = { value: unknown; expiresAt: number };
type Pending = {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  settled: boolean;
  cancelTimer?: ReturnType<typeof setTimeout>;
};

const PUBLIC_PATH = /^\/api\/(?:locations(?:\/[a-z0-9-]+)?|atlas|meta)$/;
const abortError = () =>
  new DOMException("The request was aborted.", "AbortError");

// Only these anonymous catalog reads may share work. Administrative, personal,
// authenticated, explicitly uncached, and mutation requests always use fetch.
function publicKey(path: string, init?: RequestInit): string | null {
  if (
    !path.startsWith("/api/") ||
    (init?.method || "GET").toUpperCase() !== "GET" ||
    init?.body != null ||
    [...new Headers(init?.headers)].length ||
    Object.keys(init || {}).some(
      (key) =>
        ![
          "method",
          "signal",
          "credentials",
          "cache",
          "headers",
          "body",
        ].includes(key),
    ) ||
    (init?.credentials && init.credentials !== "omit") ||
    (init?.cache && init.cache !== "default")
  )
    return null;
  const url = new URL(path, "https://phasm.invalid");
  if (!PUBLIC_PATH.test(url.pathname)) return null;
  url.searchParams.sort();
  return url.pathname + url.search;
}

async function read(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error || `Unable to load this page (${response.status}).`,
    );
  }
  return response.json();
}

export function createApiClient({
  fetcher = fetch,
  now = Date.now,
  maxEntries = 64,
  ttlMs = 30_000,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  maxEntries?: number;
  ttlMs?: number;
} = {}) {
  const cache = new Map<string, Cached>();
  const pending = new Map<string, Pending>();
  let generation = 0;
  const clear = () => {
    generation++;
    cache.clear();
    // Existing readers may finish, but reads after an edit must fetch anew.
    pending.clear();
  };
  const store = (key: string, value: unknown, response: Response) => {
    const control = response.headers.get("Cache-Control") || "";
    if (/\b(?:no-store|no-cache|private)\b/i.test(control)) return;
    const maxAge = Number(control.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] || 0);
    const age = Number(response.headers.get("Age") || 0);
    const lifetime = Math.min(ttlMs, Math.max(0, maxAge - age) * 1000);
    if (!lifetime || maxEntries < 1) return;
    for (const [oldKey, entry] of cache)
      if (entry.expiresAt <= now()) cache.delete(oldKey);
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + lifetime });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  };
  function subscribe<T>(
    key: string,
    entry: Pending,
    signal?: AbortSignal | null,
  ) {
    entry.subscribers++;
    clearTimeout(entry.cancelTimer);
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        entry.subscribers--;
        if (!entry.subscribers && !entry.settled) {
          // A same-turn remount (including React's development StrictMode)
          // can subscribe before we cancel a request nobody needs anymore.
          entry.cancelTimer = setTimeout(() => {
            if (entry.subscribers || entry.settled) return;
            entry.controller.abort();
            if (pending.get(key) === entry) pending.delete(key);
          }, 0);
        }
      };
      const onAbort = () => {
        release();
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      entry.promise.then(
        (value) => {
          if (finished) return;
          release();
          resolve(value as T);
        },
        (error) => {
          if (finished) return;
          release();
          reject(error);
        },
      );
    });
  }
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (init?.signal?.aborted) throw abortError();
    const key = publicKey(path, init);
    if (!key) {
      const response = await fetcher(path, init);
      if (
        response.ok &&
        !["GET", "HEAD"].includes((init?.method || "GET").toUpperCase())
      )
        clear();
      return (await read(response)) as T;
    }
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.value as T;
    }
    cache.delete(key);
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const startedGeneration = generation;
      entry = {
        controller,
        subscribers: 0,
        settled: false,
        promise: Promise.resolve(),
      };
      const current = entry;
      entry.promise = fetcher(key, {
        ...init,
        credentials: "omit",
        // Revalidate when the memory entry expires or an edit clears it;
        // do not extend old browser-cached data for another 30 seconds.
        cache: "no-cache",
        signal: controller.signal,
      })
        .then(async (response) => {
          const value = await read(response);
          if (!controller.signal.aborted && generation === startedGeneration)
            store(key, value, response);
          return value;
        })
        .finally(() => {
          current.settled = true;
          clearTimeout(current.cancelTimer);
          if (pending.get(key) === current) pending.delete(key);
        });
      pending.set(key, entry);
    }
    return subscribe<T>(key, entry, init?.signal);
  }
  return { request, clear };
}

export const api = createApiClient().request;
