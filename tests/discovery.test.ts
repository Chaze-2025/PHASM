import assert from "node:assert/strict";
import test from "node:test";
import { DIRECTORY_PAGE_SIZE, US_STATES, findState } from "../shared/discovery";
import { routeMetadata } from "../src/seo";

test("state directory has 50 unique, round-trippable state routes", () => {
  assert.equal(US_STATES.length, 50);
  assert.equal(new Set(US_STATES.map((state) => state.code)).size, 50);
  assert.equal(new Set(US_STATES.map((state) => state.slug)).size, 50);
  assert.equal(DIRECTORY_PAGE_SIZE, 24);
  for (const state of US_STATES) {
    assert.equal(findState(state.code.toLowerCase()), state);
    assert.equal(findState(state.name.toUpperCase()), state);
    assert.equal(findState(` ${state.slug} `), state);
  }
  assert.equal(findState("not-a-state"), undefined);
  assert.equal(findState("CA' OR 1=1"), undefined);
});

test("directory metadata keeps paginated canonical links and strips unrelated queries", () => {
  const page = routeMetadata(
    "/haunted-places/new-york",
    "?page=3&utm_source=test",
  );
  assert.equal(page.path, "/haunted-places/new-york?page=3");
  assert.equal(page.title, "Haunted Places in New York — Page 3 | PHASM");
  assert.equal(
    routeMetadata("/haunted-places/new-york", "?page=1").path,
    "/haunted-places/new-york",
  );
  assert.equal(
    routeMetadata("/haunted-places/new-york", "?page=-1").path,
    "/haunted-places/new-york",
  );
  assert.equal(routeMetadata("/map", "?q=ghost&state=NY").path, "/map");
});

test("client metadata distinguishes public routes from private, empty, and unknown pages", () => {
  for (const path of [
    "/saved",
    "/account",
    "/cases",
    "/admin",
    "/admin/review",
    "/haunted-places/atlantis",
    "/unknown",
  ]) {
    assert.equal(routeMetadata(path, "").noindex, true, path);
  }
  for (const path of [
    "/",
    "/map",
    "/about",
    "/haunted-places",
    "/haunted-places/alabama",
    "/locations/stanley-hotel",
  ]) {
    assert.notEqual(routeMetadata(path, "").noindex, true, path);
  }
});
