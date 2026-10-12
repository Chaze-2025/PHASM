import test from "node:test";
import assert from "node:assert/strict";
import { locationImageSources } from "../src/location";

test("photo patches and external WebP files never request nonexistent card derivatives", () => {
  assert.equal(locationImageSources("/images/research/abc123.webp"), undefined);
  assert.equal(
    locationImageSources("https://example.com/selected.webp"),
    undefined,
  );
  assert.equal(locationImageSources("/images/research/abc123.jpg"), undefined);
  assert.equal(
    locationImageSources("/images/location-placeholder.svg"),
    undefined,
  );
  assert.equal(
    locationImageSources("/images/stanley-hotel.webp"),
    "/images/stanley-hotel-card.webp 720w, /images/stanley-hotel.webp 1920w",
  );
});
