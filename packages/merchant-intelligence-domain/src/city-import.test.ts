import assert from "node:assert/strict";
import test from "node:test";
import { SeededRepository } from "@city-wallet/db";
import type { ActivateCommerceZoneRequest, CommerceZone, Merchant } from "@city-wallet/contracts";
import { calculateDistanceMeters } from "@city-wallet/utils";
import {
  activateCommerceZoneAndImport,
  buildImportJobsForTest,
  buildImportPreview,
  enrichImportedMerchantWithSyntheticData,
} from "./index";

test("buildImportPreview clamps radius/tiles but leaves merchant target unclamped", () => {
  const request: ActivateCommerceZoneRequest = {
    mode: "center_radius",
    centerLat: 48.13,
    centerLng: 11.58,
    radiusMeters: 99_000,
    maxImportedMerchants: 9_000,
    maxTilesPerRun: 99,
    categories: ["cafe", "bookshop"],
    categoryCaps: { cafe: 5_000, bookshop: 4_000 },
    forceRefresh: false,
    previewOnly: true,
    country: "DE",
  };
  const preview = buildImportPreview(request);
  assert.equal(preview.radiusMeters, 25_000);
  assert.equal(preview.maxImportedMerchants, 9_000);
  assert.equal(preview.maxTilesPerRun, 50);
  assert.equal(preview.categoryCaps.cafe, 5_000);
  assert.equal(preview.categoryCaps.bookshop, 4_000);
  assert.ok(preview.warnings.some((warning) => warning.includes("Radius clamped")));
});

test("buildImportPreview redistributes leftover headroom across categories when total exceeds sum of caps", () => {
  const request: ActivateCommerceZoneRequest = {
    mode: "center_radius",
    centerLat: 48.13,
    centerLng: 11.58,
    radiusMeters: 5_000,
    maxImportedMerchants: 1_000,
    maxTilesPerRun: 5,
    categories: ["cafe", "bookshop"],
    categoryCaps: { cafe: 100, bookshop: 100 },
    forceRefresh: false,
    previewOnly: true,
    country: "DE",
  };
  const preview = buildImportPreview(request);
  assert.equal(preview.categoryCaps.cafe, 500);
  assert.equal(preview.categoryCaps.bookshop, 500);
  assert.ok(
    preview.warnings.some((warning) =>
      warning.includes("Total target 1000 exceeds the sum of category caps 200"),
    ),
  );
});

test("synthetic enrichment is deterministic for an imported OSM merchant", () => {
  const merchant: Merchant = {
    id: "disc_osm_1",
    externalId: "osm_node_1",
    name: "OSM Cafe",
    category: "cafe",
    zoneId: "zone",
    distanceMeters: 50,
    latitude: 48.13,
    longitude: 11.58,
    participationStatus: "partner",
    source: "osm_overpass",
    syntheticFields: [],
    products: [],
    goals: [],
  };
  const left = enrichImportedMerchantWithSyntheticData(merchant);
  const right = enrichImportedMerchantWithSyntheticData(merchant);
  assert.equal(left.participationStatus, "partner");
  assert.deepEqual(left.products, right.products);
  assert.deepEqual(left.rule, right.rule);
});

test("Google city import continues past checkpoint chunks until merchant target is reached", async () => {
  const { restore } = installGooglePlacesMock();
  process.env.GOOGLE_PLACES_API_KEY = "test_key";
  process.env.CITY_IMPORT_POI_PROVIDER = "google_places";
  process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT = "1000";
  try {
    const repository = new SeededRepository();
    const result = await activateCommerceZoneAndImport({
      repository,
      request: {
        mode: "center_radius",
        name: "Checkpoint test zone",
        city: "Munich",
        country: "DE",
        centerLat: 48.137,
        centerLng: 11.575,
        radiusMeters: 3_000,
        maxImportedMerchants: 25,
        maxTilesPerRun: 1,
        categories: ["cafe", "bookshop"],
        forceRefresh: false,
        previewOnly: false,
      },
    });

    assert.equal(result.importRun?.status, "completed");
    assert.equal(result.importRun?.importedCount, 25);
    assert.equal(result.importRun?.providerStatsJson.stopReason, "target_reached");
    assert.ok(Number(result.importRun?.providerStatsJson.googlePlacesRequests ?? 0) > 1);
  } finally {
    restore();
  }
});

test("Google city import stops with explicit request-cap reason", async () => {
  const { restore } = installGooglePlacesMock();
  process.env.GOOGLE_PLACES_API_KEY = "test_key";
  process.env.CITY_IMPORT_POI_PROVIDER = "google_places";
  process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT = "1";
  try {
    const repository = new SeededRepository();
    const result = await activateCommerceZoneAndImport({
      repository,
      request: {
        mode: "center_radius",
        name: "Request cap test zone",
        city: "Munich",
        country: "DE",
        centerLat: 48.137,
        centerLng: 11.575,
        radiusMeters: 3_000,
        maxImportedMerchants: 50,
        maxTilesPerRun: 1,
        categories: ["cafe", "bookshop"],
        forceRefresh: false,
        previewOnly: false,
      },
    });

    assert.equal(result.importRun?.status, "paused");
    assert.equal(result.importRun?.importedCount, 20);
    assert.equal(result.importRun?.providerStatsJson.stopReason, "google_request_cap_reached");
  } finally {
    restore();
  }
});

test("large import tiles are ordered center-out", () => {
  const zone: CommerceZone = {
    id: "zone_test",
    name: "Test Zone",
    city: "Munich",
    country: "DE",
    zoneType: "city_zone",
    centerLat: 48.137,
    centerLng: 11.575,
    radiusMeters: 20_000,
    isActive: true,
    triggerPolicyIds: [],
  };
  const [firstJob] = buildImportJobsForTest(zone, 20_000, ["cafe"]);
  assert.ok(firstJob);
  const tileCenterLat = (firstJob.tile.north + firstJob.tile.south) / 2;
  const tileCenterLng = (firstJob.tile.east + firstJob.tile.west) / 2;
  assert.ok(calculateDistanceMeters(zone.centerLat, zone.centerLng, tileCenterLat, tileCenterLng) < 2_000);
});

test("repeating city activation reuses stored merchants without Google calls", async () => {
  const { restore, state } = installGooglePlacesMock();
  process.env.GOOGLE_PLACES_API_KEY = "test_key";
  process.env.CITY_IMPORT_POI_PROVIDER = "google_places";
  process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT = "1000";
  try {
    const repository = new SeededRepository();
    const request: ActivateCommerceZoneRequest = {
      mode: "center_radius",
      name: "Cached City",
      city: "Munich",
      country: "DE",
      centerLat: 48.137,
      centerLng: 11.575,
      radiusMeters: 3_000,
      maxImportedMerchants: 10,
      maxTilesPerRun: 1,
      categories: ["cafe"],
      forceRefresh: false,
      previewOnly: false,
    };
    const first = await activateCommerceZoneAndImport({ repository, request });
    const callsAfterFirstRun = state.requestCount;
    const second = await activateCommerceZoneAndImport({ repository, request });

    assert.equal(state.requestCount, callsAfterFirstRun);
    assert.equal(second.importRun?.status, "completed");
    assert.equal(second.importRun?.importedCount, first.importRun?.importedCount);
    assert.equal(second.importRun?.providerStatsJson.stopReason, "city_merchant_cache_reused");
    assert.equal(second.preview.existingStoredMerchantCount, first.importRun?.importedCount);
    assert.equal(second.preview.cacheReuseAvailable, true);
  } finally {
    restore();
  }
});

test("increasing city import target creates incremental run and skips existing merchants", async () => {
  const { restore, state } = installGooglePlacesMock();
  process.env.GOOGLE_PLACES_API_KEY = "test_key";
  process.env.CITY_IMPORT_POI_PROVIDER = "google_places";
  process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT = "1000";
  try {
    const repository = new SeededRepository();
    const request: ActivateCommerceZoneRequest = {
      mode: "center_radius",
      name: "Incremental City",
      city: "Munich",
      country: "DE",
      centerLat: 48.137,
      centerLng: 11.575,
      radiusMeters: 3_000,
      maxImportedMerchants: 10,
      maxTilesPerRun: 1,
      categories: ["cafe", "bookshop"],
      categoryCaps: { cafe: 40, bookshop: 40 },
      forceRefresh: false,
      previewOnly: false,
    };
    const first = await activateCommerceZoneAndImport({ repository, request });
    const callsAfterFirstRun = state.requestCount;
    const second = await activateCommerceZoneAndImport({
      repository,
      request: {
        ...request,
        maxImportedMerchants: 25,
        categoryCaps: { cafe: 40, bookshop: 40 },
      },
    });
    const stored = await repository.listMerchants({ zoneId: first.zone.id });

    assert.equal(second.preview.plannedImportAction, "incremental_import");
    assert.equal(second.importRun?.importedCount, 25);
    assert.equal(stored.length, 25);
    assert.equal(new Set(stored.map((merchant) => merchant.id)).size, 25);
    assert.ok(state.requestCount > callsAfterFirstRun);
  } finally {
    restore();
  }
});

test("decreasing city import settings keeps stored merchants and skips provider calls", async () => {
  const { restore, state } = installGooglePlacesMock();
  process.env.GOOGLE_PLACES_API_KEY = "test_key";
  process.env.CITY_IMPORT_POI_PROVIDER = "google_places";
  process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT = "1000";
  try {
    const repository = new SeededRepository();
    const request: ActivateCommerceZoneRequest = {
      mode: "center_radius",
      name: "Decrease City",
      city: "Munich",
      country: "DE",
      centerLat: 48.137,
      centerLng: 11.575,
      radiusMeters: 3_000,
      maxImportedMerchants: 20,
      maxTilesPerRun: 1,
      categories: ["cafe"],
      categoryCaps: { cafe: 20 },
      forceRefresh: false,
      previewOnly: false,
    };
    const first = await activateCommerceZoneAndImport({ repository, request });
    const callsAfterFirstRun = state.requestCount;
    const second = await activateCommerceZoneAndImport({
      repository,
      request: {
        ...request,
        maxImportedMerchants: 5,
        categoryCaps: { cafe: 5 },
      },
    });
    const stored = await repository.listMerchants({ zoneId: first.zone.id });

    assert.equal(state.requestCount, callsAfterFirstRun);
    assert.equal(second.preview.plannedImportAction, "settings_decreased_no_delete");
    assert.equal(second.importRun?.providerStatsJson.stopReason, "city_merchant_cache_reused");
    assert.equal(stored.length, 20);
    assert.ok(second.warnings.some((warning) => warning.includes("Existing merchants are kept")));
  } finally {
    restore();
  }
});

test("force refresh bypasses stored city merchant cache", async () => {
  const { restore, state } = installGooglePlacesMock();
  process.env.GOOGLE_PLACES_API_KEY = "test_key";
  process.env.CITY_IMPORT_POI_PROVIDER = "google_places";
  process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT = "1000";
  try {
    const repository = new SeededRepository();
    const request: ActivateCommerceZoneRequest = {
      mode: "center_radius",
      name: "Force Refresh City",
      city: "Munich",
      country: "DE",
      centerLat: 48.137,
      centerLng: 11.575,
      radiusMeters: 3_000,
      maxImportedMerchants: 10,
      maxTilesPerRun: 1,
      categories: ["cafe"],
      forceRefresh: false,
      previewOnly: false,
    };
    await activateCommerceZoneAndImport({ repository, request });
    const callsAfterFirstRun = state.requestCount;
    const second = await activateCommerceZoneAndImport({
      repository,
      request: { ...request, forceRefresh: true },
    });

    assert.equal(state.requestCount, callsAfterFirstRun);
    assert.notEqual(second.importRun?.providerStatsJson.stopReason, "city_merchant_cache_reused");
    assert.ok(Number(second.importRun?.providerStatsJson.cacheHits ?? 0) >= 1);
  } finally {
    restore();
  }
});

function installGooglePlacesMock() {
  const originalFetch = globalThis.fetch;
  const state = { requestCount: 0 };
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    state.requestCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      includedTypes?: string[];
      locationRestriction?: { circle?: { center?: { latitude?: number; longitude?: number } } };
    };
    const center = body.locationRestriction?.circle?.center ?? { latitude: 48.137, longitude: 11.575 };
    const primaryType = body.includedTypes?.[0] ?? "cafe";
    const places = Array.from({ length: 20 }, (_, index) => ({
      id: `place_${state.requestCount}_${index}`,
      displayName: { text: `Place ${state.requestCount}-${index}` },
      location: {
        latitude: Number(center.latitude ?? 48.137) + index * 0.00001,
        longitude: Number(center.longitude ?? 11.575) + index * 0.00001,
      },
      primaryType,
      types: [primaryType],
      formattedAddress: "Test Address",
    }));
    return new Response(JSON.stringify({ places }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    state,
    restore: () => {
      globalThis.fetch = originalFetch;
      delete process.env.GOOGLE_PLACES_API_KEY;
      delete process.env.CITY_IMPORT_POI_PROVIDER;
      delete process.env.GOOGLE_PLACES_MAX_REQUESTS_PER_IMPORT;
    },
  };
}
