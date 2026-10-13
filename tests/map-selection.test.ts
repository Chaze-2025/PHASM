import assert from "node:assert/strict";
import test from "node:test";
import { overlappingMapChoices } from "../src/map-selection";
import {
  coordinateReferenceAttribution,
  coordinateReferenceDescription,
  coordinateReferenceLabel,
} from "../src/location";
import type { CoordinateReference } from "../shared/types";

function point(slug: string, name = slug) {
  return {
    geometry: { type: "Point", coordinates: [-105.52, 40.38] },
    properties: { slug, name, category: "Hotel", clustered: false },
  };
}

test("overlapping markers retain every profile, deduplicate rendered tiles, and never shift coordinates", () => {
  const features = [
    point("hotel-b", "B hotel"),
    point("hotel-a", "A hotel"),
    point("hotel-b", "B hotel"),
  ];
  const before = structuredClone(features);
  const choices = overlappingMapChoices(features);
  assert.deepEqual(
    choices.map((choice) => choice.slug),
    ["hotel-a", "hotel-b"],
  );
  assert.ok(choices.every((choice) => choice.coordinates[0] === -105.52));
  assert.ok(choices.every((choice) => choice.coordinates[1] === 40.38));
  assert.deepEqual(features, before);
  assert.equal(overlappingMapChoices([point("single")]).length, 1);
});

test("aggregates and invalid rendered features never become selectable individual profiles", () => {
  const base = point("valid");
  assert.deepEqual(
    overlappingMapChoices([
      { ...base, properties: { ...base.properties, clustered: true } },
      { ...base, properties: { ...base.properties, point_count: 8 } },
      { ...base, properties: { ...base.properties, slug: "" } },
      { ...base, properties: null },
      { ...base, geometry: { type: "LineString", coordinates: [-105, 40] } },
      { ...base, geometry: { type: "Point", coordinates: [NaN, 40] } },
    ]),
    [],
  );
});

test("reference labels distinguish a sourced site point from broader geographic references", () => {
  assert.equal(coordinateReferenceLabel({}), undefined);
  assert.equal(coordinateReferenceDescription({}), undefined);
  const expected = {
    site: "Site reference",
    locality: "Town/area reference",
    county: "County reference",
    state: "State reference",
  };
  for (const scope of Object.keys(expected) as CoordinateReference["scope"][]) {
    const location = {
      coordinateReference: {
        scope,
        label: "Example place",
        sourceUrl: "https://example.com/source",
      },
    };
    assert.equal(
      coordinateReferenceLabel(location),
      `${expected[scope]}: Example place`,
    );
    assert.match(
      coordinateReferenceDescription(location)!,
      scope === "site"
        ? /sourced site reference point/
        : /not the site's exact position/,
    );
  }
});

test("reference attribution identifies Census sources and carries the GeoNames license", () => {
  const reference = (sourceUrl: string) => ({
    coordinateReference: {
      scope: "locality" as const,
      label: "Example place",
      sourceUrl,
    },
  });
  assert.deepEqual(
    coordinateReferenceAttribution(
      reference("https://download.geonames.org/export/dump/US.zip"),
    ),
    {
      name: "GeoNames",
      license: {
        name: "CC BY 4.0",
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    },
  );
  assert.deepEqual(
    coordinateReferenceAttribution(
      reference("https://www.census.gov/geographies/reference-files.html"),
    ),
    { name: "U.S. Census Bureau" },
  );
  assert.deepEqual(
    coordinateReferenceAttribution(
      reference("https://geonames.org.example.com/"),
    ),
    { name: "Map reference source" },
  );
});
