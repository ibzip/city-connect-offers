export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${rand}`;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function stableHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase();
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function calculateDistanceMeters(
  userLat: number,
  userLng: number,
  merchantLat: number,
  merchantLng: number,
) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(merchantLat - userLat);
  const deltaLng = toRadians(merchantLng - userLng);
  const startLat = toRadians(userLat);
  const endLat = toRadians(merchantLat);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Math.round(earthRadiusMeters * centralAngle);
}

export type RadiusZone = {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  polygonGeoJson?: unknown;
};

export function isPointInsideZone(lat: number, lng: number, zone: RadiusZone) {
  const polygon = extractPolygon(zone.polygonGeoJson);
  if (polygon) {
    return isPointInsidePolygon(lat, lng, polygon);
  }
  return calculateDistanceMeters(lat, lng, zone.centerLat, zone.centerLng) <= zone.radiusMeters;
}

function extractPolygon(value: unknown): number[][] | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: string; coordinates?: unknown };
  if (candidate.type === "Polygon" && Array.isArray(candidate.coordinates)) {
    const firstRing = candidate.coordinates[0];
    if (Array.isArray(firstRing)) return firstRing as number[][];
  }
  if (candidate.type === "Feature" && "geometry" in candidate) {
    return extractPolygon((candidate as { geometry?: unknown }).geometry);
  }
  return null;
}

function isPointInsidePolygon(lat: number, lng: number, ring: number[][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const currentLng = currentPoint[0];
    const currentLat = currentPoint[1];
    const previousLng = previousPoint[0];
    const previousLat = previousPoint[1];
    const intersects =
      currentLat > lat !== previousLat > lat &&
      lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat || Number.EPSILON) + currentLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function roundCoordinate(value: number, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function rectanglePolygonGeoJson(input: { north: number; south: number; east: number; west: number }) {
  return {
    type: "Polygon",
    coordinates: [[
      [input.west, input.south],
      [input.east, input.south],
      [input.east, input.north],
      [input.west, input.north],
      [input.west, input.south],
    ]],
  };
}

export function timeBucketKey(date = new Date(), bucketMs = 5 * 60 * 1000) {
  return Math.floor(date.getTime() / bucketMs).toString(36);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
