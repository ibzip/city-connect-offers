import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistanceMeters, isPointInsideZone } from "./index";

test("calculateDistanceMeters uses Haversine distance", () => {
  const meters = calculateDistanceMeters(48.775845, 9.177544, 48.7761, 9.17658);
  assert.ok(meters > 60 && meters < 90);
});

test("isPointInsideZone supports radius geofences", () => {
  const zone = { centerLat: 48.775845, centerLng: 9.177544, radiusMeters: 500 };
  assert.equal(isPointInsideZone(48.7761, 9.17658, zone), true);
  assert.equal(isPointInsideZone(48.782, 9.19, zone), false);
});

test("isPointInsideZone supports polygon geofences", () => {
  const zone = {
    centerLat: 0,
    centerLng: 0,
    radiusMeters: 1,
    polygonGeoJson: {
      type: "Polygon",
      coordinates: [[
        [9.17, 48.77],
        [9.19, 48.77],
        [9.19, 48.79],
        [9.17, 48.79],
        [9.17, 48.77],
      ]],
    },
  };
  assert.equal(isPointInsideZone(48.775, 9.178, zone), true);
  assert.equal(isPointInsideZone(48.8, 9.2, zone), false);
});
