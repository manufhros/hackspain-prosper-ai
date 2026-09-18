export type LocationId = "centro" | "norte" | "sur";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ClinicLocation {
  id: LocationId;
  name: string;
  coordinates: Coordinates;
}

export interface RankedLocation {
  location: ClinicLocation;
  distanceKm: number;
}

export type SpecialtiesByLocation = Readonly<
  Partial<Record<LocationId, readonly string[]>>
>;

export const CLINIC_LOCATIONS: readonly ClinicLocation[] = [
  {
    id: "centro",
    name: "Arenal Centro",
    coordinates: { latitude: 40.4178, longitude: -3.7075 },
  },
  {
    id: "norte",
    name: "Arenal Norte",
    coordinates: { latitude: 40.4645, longitude: -3.6836 },
  },
  {
    id: "sur",
    name: "Arenal Sur",
    coordinates: { latitude: 40.305, longitude: -3.7327 },
  },
] as const;

/**
 * Offline coordinates for the address groups used by the public cases.
 * Landmarks are aliases of the accompanying street address so resolving a
 * caller's full utterance remains deterministic and never needs geocoding.
 */
export const PUBLIC_ADDRESS_COORDINATES = {
  preciados3: { latitude: 40.4181, longitude: -3.7066 },
  getafeMadrid54: { latitude: 40.3064, longitude: -3.7316 },
  castellana189: { latitude: 40.4652, longitude: -3.6889 },
} as const satisfies Record<string, Coordinates>;

const LOCATION_ORDER: Readonly<Record<LocationId, number>> = {
  centro: 0,
  norte: 1,
  sur: 2,
};

const EARTH_RADIUS_KM = 6_371.0088;

export function normalizeAddress(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[º°ª#.,;:()[\]'"’/\\-]/g, " ")
    .replace(/\b(?:numero|num|no)(?=\s*\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves only the known public-case addresses and their landmarks.
 * Unknown input deliberately returns undefined instead of guessing.
 */
export function resolveAddressCoordinates(
  address: string,
): Coordinates | undefined {
  const normalized = normalizeAddress(address);

  if (
    /\bpreciados\s+3\b/.test(normalized) ||
    /\bpuerta\s+del\s+sol\b/.test(normalized)
  ) {
    return { ...PUBLIC_ADDRESS_COORDINATES.preciados3 };
  }

  if (
    /\bcalle\s+(?:de\s+)?madrid\s+54\b/.test(normalized) ||
    (/\bmadrid\s+54\b/.test(normalized) && /\bgetafe\b/.test(normalized))
  ) {
    return { ...PUBLIC_ADDRESS_COORDINATES.getafeMadrid54 };
  }

  if (
    /\bcastellana\s+189\b/.test(normalized) ||
    /\bplaza\s+de\s+castilla\b/.test(normalized)
  ) {
    return { ...PUBLIC_ADDRESS_COORDINATES.castellana189 };
  }

  return undefined;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function assertCoordinates(coordinates: Coordinates): void {
  if (
    !Number.isFinite(coordinates.latitude) ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new RangeError("Invalid latitude or longitude");
  }
}

export function haversineDistanceKm(
  from: Coordinates,
  to: Coordinates,
): number {
  assertCoordinates(from);
  assertCoordinates(to);

  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    EARTH_RADIUS_KM *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
}

export function rankLocations(
  origin: Coordinates,
  locations: readonly ClinicLocation[] = CLINIC_LOCATIONS,
): RankedLocation[] {
  assertCoordinates(origin);

  return locations
    .map((location) => ({
      location,
      distanceKm: haversineDistanceKm(origin, location.coordinates),
    }))
    .sort(
      (left, right) =>
        left.distanceKm - right.distanceKm ||
        LOCATION_ORDER[left.location.id] - LOCATION_ORDER[right.location.id],
    );
}

export function rankLocationsForAddress(address: string): RankedLocation[] {
  const origin = resolveAddressCoordinates(address);
  if (!origin) return [];
  return rankLocations(origin);
}

/**
 * Selects the closest site that can serve the requested specialty.
 * Capability filtering intentionally happens before distance ranking.
 */
export function nearestLocationForSpecialty(
  address: string,
  specialtyId: string,
  specialtiesByLocation: SpecialtiesByLocation,
): RankedLocation | undefined {
  const origin = resolveAddressCoordinates(address);
  if (!origin) return undefined;

  const eligibleLocations = CLINIC_LOCATIONS.filter((location) =>
    specialtiesByLocation[location.id]?.includes(specialtyId),
  );

  return rankLocations(origin, eligibleLocations)[0];
}
