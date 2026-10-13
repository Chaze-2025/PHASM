import assert from "node:assert/strict";
import test from "node:test";
import type { AtlasFeature, AtlasGeoJSON } from "../shared/types";
import {
  AtlasFeed,
  atlasBounds,
  atlasPath,
  completeAtlasFeed,
  countAtlasInBounds,
  type AtlasViewport,
} from "../src/atlas-data";

function point(slug: string, longitude = -90, latitude = 40): AtlasFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    properties: {
      id: slug,
      slug,
      name: slug,
      category: "Other",
      count: 1,
      clustered: false,
    },
  };
}
function collection(
  features: AtlasFeature[],
  total = features.length,
): AtlasGeoJSON {
  return { type: "FeatureCollection", features, total, truncated: false };
}
function aggregate(): AtlasGeoJSON {
  const feature = point("grid");
  feature.properties.clustered = true;
  feature.properties.count = 5100;
  feature.properties.slug = "";
  return collection([feature], 5100);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(
  fetchData: (path: string, signal: AbortSignal) => Promise<AtlasGeoJSON>,
) {
  let viewport: AtlasViewport = { bounds: [-180, -85, 180, 85], zoom: 2 };
  const delivered: { data: AtlasGeoJSON; filterChanged: boolean }[] = [];
  const counts: number[] = [];
  const loading: boolean[] = [];
  let errors = 0;
  let fitted = false;
  let current = true;
  const feed = new AtlasFeed(fetchData, {
    viewport: () => viewport,
    isCurrent: () => current,
    loading: (changed) => loading.push(changed),
    data: (data, filterChanged) => {
      delivered.push({ data, filterChanged });
      return fitted && filterChanged;
    },
    count: (count) => counts.push(count),
    error: () => errors++,
  });
  return {
    feed,
    delivered,
    counts,
    loading,
    setViewport: (value: AtlasViewport) => {
      viewport = value;
    },
    setFitted: (value: boolean) => {
      fitted = value;
    },
    setCurrent: (value: boolean) => {
      current = value;
    },
    errors: () => errors,
  };
}

test("all 136 raw pins survive one fetch and repeated camera movements never refetch or replace them", async () => {
  const data = collection(
    Array.from({ length: 136 }, (_, i) =>
      point(`site-${i}`, -110 + i / 10, 30 + i / 20),
    ),
  );
  const requests: string[] = [];
  const h = harness(async (path) => {
    requests.push(path);
    return data;
  });
  await h.feed.load("category=Other");
  h.setViewport({ bounds: [-105, 32, -100, 35], zoom: 8 });
  for (let i = 0; i < 40; i++) await h.feed.move();
  assert.equal(requests.length, 1);
  const params = new URL(requests[0], "https://phasm.test").searchParams;
  assert.equal(params.get("zoom"), "5");
  assert.equal(params.get("format"), "points");
  assert.equal(params.has("bbox"), false);
  assert.equal(h.delivered.length, 1);
  assert.deepEqual(
    h.delivered[0].data.features.map((f) => f.properties.id),
    data.features.map((f) => f.properties.id),
  );
  assert.equal(h.counts.at(-1), countAtlasInBounds(data, [-105, 32, -100, 35]));
  assert.ok(h.counts.at(-1)! < 136);
});

test("all 2,859 pins load once per filter and remain in MapLibre through continuous camera movements", async () => {
  const data = collection(
    Array.from({ length: 2859 }, (_, i) =>
      point(`site-${i}`, -124 + (i % 120) / 3, 25 + Math.floor(i / 120)),
    ),
  );
  const requests: string[] = [];
  const h = harness(async (path) => {
    requests.push(path);
    return data;
  });
  await h.feed.load("");
  for (let i = 0; i < 80; i++) {
    h.setViewport({
      bounds: [-125 + i / 2, 27, -115 + i / 2, 45],
      zoom: 3 + i / 8,
    });
    await h.feed.move();
  }
  assert.equal(requests.length, 1);
  assert.equal(
    new URL(requests[0], "https://phasm.test").searchParams.get("format"),
    "points",
  );
  assert.equal(h.delivered.length, 1, "panning never replaces the map source");
  assert.equal(h.delivered[0].data.features.length, 2859);
  assert.deepEqual(h.delivered[0].data.features, data.features);
  assert.equal(
    h.counts.at(-1),
    countAtlasInBounds(data, [-85.5, 27, -75.5, 45]),
  );
  await h.feed.load("category=Hotel");
  assert.equal(
    requests.length,
    2,
    "a changed filter gets exactly one fresh complete feed",
  );
});

test("catalogs above 5,000 points use a bounded, deduplicated viewport fallback and retain aggregated totals", async () => {
  const requests: string[] = [];
  const h = harness(async (path) => {
    requests.push(path);
    return aggregate();
  });
  await h.feed.load("");
  assert.equal(requests.length, 2);
  assert.ok(
    new URL(requests[1], "https://phasm.test").searchParams.has("bbox"),
  );
  assert.equal(h.counts.at(-1), 5100);
  assert.equal(
    new URL(requests[0], "https://phasm.test").searchParams.get("format"),
    "points",
  );
  assert.equal(
    new URL(requests[1], "https://phasm.test").searchParams.has("format"),
    false,
  );
  await h.feed.move();
  assert.equal(requests.length, 2);
  h.setViewport({ bounds: [170, -20, -170, 20], zoom: 7 });
  await h.feed.move();
  assert.equal(requests.length, 3);
  assert.equal(
    new URL(requests[2], "https://phasm.test").searchParams.get("bbox"),
    "170,-20,-170,20",
  );
  assert.deepEqual(
    h.delivered.map((entry) => entry.filterChanged),
    [true, false, false],
  );
});

test("fallback filter fit waits for its final viewport before requesting viewport data", async () => {
  const requests: string[] = [];
  const h = harness(async (path) => {
    requests.push(path);
    return aggregate();
  });
  h.setFitted(true);
  await h.feed.load("q=cemetery");
  assert.equal(requests.length, 1);
  h.setViewport({ bounds: [-93, 35, -80, 45], zoom: 6 });
  await h.feed.move();
  assert.equal(requests.length, 2);
  assert.equal(
    new URL(requests[1], "https://phasm.test").searchParams.get("bbox"),
    "-93,35,-80,45",
  );
});

test("late filter responses cannot replace newer pins or trigger a stale camera fit even if fetch ignores abort", async () => {
  const old = deferred<AtlasGeoJSON>();
  const signals: AbortSignal[] = [];
  const h = harness((path, signal) => {
    signals.push(signal);
    return path.includes("old")
      ? old.promise
      : Promise.resolve(collection([point("new")]));
  });
  const first = h.feed.load("q=old");
  await h.feed.load("q=new");
  old.resolve(collection([point("old")]));
  await first;
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(
    h.delivered.map((entry) => entry.data.features[0].properties.slug),
    ["new"],
  );
  assert.equal(h.errors(), 0);
});

test("superseded viewport responses and disposed responses cannot alter the map", async () => {
  const first = deferred<AtlasGeoJSON>();
  const second = deferred<AtlasGeoJSON>();
  const requests: AbortSignal[] = [];
  const h = harness((path, signal) => {
    requests.push(signal);
    if (!new URL(path, "https://phasm.test").searchParams.has("bbox"))
      return Promise.resolve(aggregate());
    return requests.length === 2 ? first.promise : second.promise;
  });
  h.setFitted(true);
  await h.feed.load("q=place");
  const earlier = h.feed.move();
  h.setViewport({ bounds: [-100, 20, -80, 45], zoom: 8 });
  const later = h.feed.move();
  second.resolve(collection([point("latest-viewport")]));
  await later;
  first.resolve(collection([point("obsolete-viewport")]));
  await earlier;
  assert.equal(requests[1].aborted, true);
  assert.equal(
    h.delivered.at(-1)!.data.features[0].properties.slug,
    "latest-viewport",
  );

  const pending = deferred<AtlasGeoJSON>();
  const removed = harness(() => pending.promise);
  const load = removed.feed.load("");
  removed.feed.dispose();
  pending.resolve(collection([point("removed")]));
  await load;
  assert.equal(removed.delivered.length, 0);
});

test("a render's newer filter invalidates a response before the next effect starts", async () => {
  const pending = deferred<AtlasGeoJSON>();
  const h = harness(() => pending.promise);
  const load = h.feed.load("q=old");
  h.setCurrent(false);
  pending.resolve(collection([point("old")]));
  await load;
  assert.equal(h.delivered.length, 0);
  assert.equal(h.counts.length, 0);
});

test("failed feeds can retry on camera movement without exposing stale data", async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new Error("temporarily unavailable");
    return collection([point("recovered")]);
  });
  await h.feed.load("q=hotel");
  assert.equal(h.errors(), 1);
  await h.feed.move();
  assert.equal(calls, 2);
  assert.equal(h.delivered[0].data.features[0].properties.slug, "recovered");
});

test("complete-feed detection, wrapped viewport counts and request scope handle boundaries", () => {
  assert.equal(completeAtlasFeed(collection([])), true);
  assert.equal(completeAtlasFeed(aggregate()), false);
  const atLimit = Array.from({ length: 5000 }, (_, i) => point(`limit-${i}`));
  assert.equal(completeAtlasFeed(collection(atLimit)), true);
  assert.equal(
    completeAtlasFeed(collection([...atLimit, point("overflow")])),
    false,
  );
  assert.equal(completeAtlasFeed(collection([point("partial")], 2)), false);
  assert.equal(
    completeAtlasFeed({ ...collection([point("truncated")]), truncated: true }),
    false,
  );
  assert.deepEqual(
    atlasBounds(-200, -90, 200, 90),
    [-180, -85.051129, 180, 85.051129],
  );
  assert.deepEqual(atlasBounds(170, -20, 190, 20), [170, -20, -170, 20]);
  const data = collection([
    point("east", 179, 0),
    point("west", -179, 0),
    point("middle", 0, 0),
  ]);
  assert.equal(countAtlasInBounds(data, [170, -20, -170, 20]), 2);
  const params = new URL(
    atlasPath("q=hotel&page=4&view=list&bbox=1,2,3,4&zoom=1&format=summary"),
    "https://phasm.test",
  ).searchParams;
  assert.deepEqual(
    [...params.entries()],
    [
      ["q", "hotel"],
      ["zoom", "5"],
      ["format", "points"],
    ],
  );
});
