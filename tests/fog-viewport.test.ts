import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFogSurface,
  type FogSurface,
  type FogViewportInput,
} from "../src/fog-viewport";

function phone(changes: Partial<FogViewportInput> = {}): FogViewportInput {
  return {
    innerWidth: 393,
    innerHeight: 844,
    clientWidth: 393,
    clientHeight: 844,
    visualViewport: { width: 393, height: 760, offsetLeft: 0, offsetTop: 0 },
    orientation: "portrait-primary",
    ...changes,
  };
}

function bounds(surface: FogSurface) {
  return [surface.left, surface.top, surface.width, surface.height];
}

function covers(
  surface: FogSurface,
  rect: { left: number; top: number; width: number; height: number },
) {
  assert.ok(surface.left <= rect.left - 31);
  assert.ok(surface.top <= rect.top - 31);
  assert.ok(surface.left + surface.width >= rect.left + rect.width + 31);
  assert.ok(surface.top + surface.height >= rect.top + rect.height + 31);
}

test("surface covers the union of layout, inner and Safari visual viewport with overscan", () => {
  const result = calculateFogSurface(
    undefined,
    phone({
      innerHeight: 780,
      visualViewport: { width: 393, height: 830, offsetLeft: 0, offsetTop: 35 },
    }),
  );
  covers(result, { left: 0, top: 0, width: 393, height: 844 });
  covers(result, { left: 0, top: 35, width: 393, height: 830 });
  assert.equal(result.worldScale, 393);
  assert.ok(result.top < 0);
  assert.ok(result.top + result.height > 844);
});

test("Safari toolbar collapse and regrowth reuse bounds and shader scale", () => {
  let result = calculateFogSurface(
    undefined,
    phone({ innerHeight: 720, clientHeight: 720 }),
  );
  const originalBounds = bounds(result);
  for (const height of [730, 760, 800, 844, 800, 750, 720, 844]) {
    result = calculateFogSurface(
      result,
      phone({
        innerHeight: height,
        clientHeight: height,
        visualViewport: { width: 393, height, offsetLeft: 0, offsetTop: 0 },
      }),
    );
    assert.deepEqual(bounds(result), originalBounds);
    assert.equal(result.worldScale, 393);
    covers(result, result.visual);
  }
  assert.equal(result.heightHighWater, 844);
});

test("keyboard opening and closing cannot shrink, rescale or infer a false landscape rotation", () => {
  const initial = calculateFogSurface(undefined, phone());
  const keyboard = calculateFogSurface(
    initial,
    phone({
      innerHeight: 260,
      clientHeight: 260,
      visualViewport: { width: 393, height: 230, offsetLeft: 0, offsetTop: 95 },
    }),
  );
  const restored = calculateFogSurface(keyboard, phone());
  assert.deepEqual(bounds(keyboard), bounds(initial));
  assert.deepEqual(bounds(restored), bounds(initial));
  assert.equal(keyboard.heightHighWater, 844);
  assert.equal(keyboard.worldScale, initial.worldScale);
});

test("pinch zoom and visual panning preserve layout scale and do not ratchet allocation", () => {
  let result = calculateFogSurface(undefined, phone());
  const original = bounds(result);
  for (const [left, top] of [
    [0, 0],
    [60, 180],
    [190, 400],
    [0, 0],
  ]) {
    result = calculateFogSurface(
      result,
      phone({
        visualViewport: {
          width: 196.5,
          height: 422,
          offsetLeft: left,
          offsetTop: top,
        },
      }),
    );
    assert.deepEqual(bounds(result), original);
    assert.equal(result.worldScale, 393);
    covers(result, result.visual);
  }
  for (let i = 0; i < 100; i++) {
    result = calculateFogSurface(
      result,
      phone({
        visualViewport: {
          width: 196.5,
          height: 422,
          offsetLeft: i % 2 ? 1e9 : -1e9,
          offsetTop: i % 2 ? -1e9 : 1e9,
        },
      }),
    );
    assert.equal(result.heightHighWater, 844);
    assert.ok(result.width <= 393 + 4 * 160 + 128);
    assert.ok(result.height <= 844 + 4 * 160 + 128);
    covers(result, result.visual);
  }
});

test("large window growth allocates once and subsequent collapse/regrowth reuses it", () => {
  const short = calculateFogSurface(
    undefined,
    phone({ innerHeight: 600, clientHeight: 600, visualViewport: undefined }),
  );
  const tall = calculateFogSurface(
    short,
    phone({ innerHeight: 1100, clientHeight: 1100, visualViewport: undefined }),
  );
  assert.ok(tall.height > short.height);
  const collapsed = calculateFogSurface(
    tall,
    phone({ innerHeight: 600, clientHeight: 600, visualViewport: undefined }),
  );
  const regrown = calculateFogSurface(
    collapsed,
    phone({ innerHeight: 1100, clientHeight: 1100, visualViewport: undefined }),
  );
  assert.deepEqual(bounds(collapsed), bounds(tall));
  assert.deepEqual(bounds(regrown), bounds(tall));
  covers(tall, { left: 0, top: 0, width: 393, height: 1100 });
});

test("real width changes and physical rotation reset retained portrait height", () => {
  const portrait = calculateFogSurface(undefined, phone());
  const landscape = calculateFogSurface(portrait, {
    innerWidth: 844,
    innerHeight: 393,
    clientWidth: 844,
    clientHeight: 393,
    orientation: "landscape-primary",
  });
  assert.equal(landscape.heightHighWater, 393);
  assert.equal(landscape.worldScale, 844);
  assert.ok(landscape.height < portrait.height);
  const minorWidth = calculateFogSurface(
    portrait,
    phone({ innerWidth: 397, clientWidth: 397 }),
  );
  assert.equal(minorWidth.worldScale, portrait.worldScale);
  assert.deepEqual(bounds(minorWidth), bounds(portrait));
  const materialWidth = calculateFogSurface(
    portrait,
    phone({
      innerWidth: 430,
      clientWidth: 430,
      innerHeight: 700,
      clientHeight: 700,
      visualViewport: undefined,
    }),
  );
  assert.equal(materialWidth.worldScale, 430);
  assert.equal(materialWidth.heightHighWater, 700);
});

test("layout positions map to continuous shader coordinates when overscan allocation grows", () => {
  const initial = calculateFogSurface(undefined, phone());
  const expanded = calculateFogSurface(
    initial,
    phone({
      innerHeight: 1300,
      clientHeight: 1300,
      visualViewport: undefined,
    }),
  );
  assert.notEqual(initial.height, expanded.height);
  const worldCoordinate = (surface: FogSurface, x: number, y: number) => {
    const uv = [
      (x - surface.left) / surface.width,
      (y - surface.top) / surface.height,
    ];
    return [
      (surface.left + uv[0] * surface.width) / surface.worldScale,
      (surface.top + uv[1] * surface.height) / surface.worldScale,
    ];
  };
  for (const [x, y] of [
    [0, 0],
    [196.5, 422],
    [393, 844],
  ]) {
    const before = worldCoordinate(initial, x, y);
    const after = worldCoordinate(expanded, x, y);
    assert.ok(Math.abs(before[0] - after[0]) < 1e-12);
    assert.ok(Math.abs(before[1] - after[1]) < 1e-12);
  }
});

test("missing or invalid browser metrics still return finite bounded coverage", () => {
  const result = calculateFogSurface(undefined, {
    innerWidth: NaN,
    innerHeight: Infinity,
    clientWidth: 0,
    clientHeight: -1,
    visualViewport: {
      width: 393,
      height: 844,
      offsetLeft: Infinity,
      offsetTop: NaN,
    },
  });
  assert.equal(result.layoutWidth, 393);
  assert.equal(result.heightHighWater, 844);
  assert.equal(result.visual.left, 0);
  assert.equal(result.visual.top, 0);
  assert.ok(bounds(result).every(Number.isFinite));
  covers(result, result.visual);
});
