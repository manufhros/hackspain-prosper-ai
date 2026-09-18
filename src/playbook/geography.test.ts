import { describe, expect, test } from "bun:test";
import {
  CLINIC_LOCATIONS,
  haversineDistanceKm,
  nearestLocationForSpecialty,
  normalizeAddress,
  rankLocations,
  rankLocationsForAddress,
  resolveAddressCoordinates,
} from "./geography";

describe("offline geography", () => {
  test("normalizes accents, punctuation, and spacing", () => {
    expect(normalizeAddress("  Paseo de la CASTELLANA, nº 189  ")).toBe(
      "paseo de la castellana 189",
    );
  });

  test.each([
    [
      "I'm right in the centre, at Calle de Preciados 3, by Puerta del Sol",
      "centro",
    ],
    ["I'm in Getafe, at Calle de Madrid 54", "sur"],
    [
      "I'm at Paseo de la Castellana 189, at Plaza de Castilla",
      "norte",
    ],
  ] as const)("ranks the expected site for %s", (address, expected) => {
    expect(rankLocationsForAddress(address)[0]?.location.id).toBe(expected);
  });

  test("resolves the public landmarks without network geocoding", () => {
    expect(resolveAddressCoordinates("Puerta del Sol")).toBeDefined();
    expect(resolveAddressCoordinates("Plaza de Castilla")).toBeDefined();
    expect(resolveAddressCoordinates("an unknown address")).toBeUndefined();
  });
});

describe("Haversine and deterministic ranking", () => {
  test("returns zero for the same point", () => {
    const centro = CLINIC_LOCATIONS[0]!;
    expect(
      haversineDistanceKm(centro.coordinates, centro.coordinates),
    ).toBe(0);
  });

  test("uses a stable site order to break equal distances", () => {
    const origin = CLINIC_LOCATIONS[0]!.coordinates;
    const tiedLocations = CLINIC_LOCATIONS.map((location) => ({
      ...location,
      coordinates: origin,
    }));

    expect(
      rankLocations(origin, [...tiedLocations].reverse()).map(
        ({ location }) => location.id,
      ),
    ).toEqual(["centro", "norte", "sur"]);
  });
});

describe("specialty-aware nearest site", () => {
  test("chooses Centro for Getafe gynaecology when only Centro is eligible", () => {
    const result = nearestLocationForSpecialty(
      "Calle de Madrid 54, 28902 Getafe",
      "gynaecology",
      {
        centro: ["gynaecology"],
        norte: ["orthopaedics"],
        sur: ["general_practice", "paediatrics"],
      },
    );

    expect(result?.location.id).toBe("centro");
  });

  test("returns no site when no location serves the specialty", () => {
    expect(
      nearestLocationForSpecialty(
        "Puerta del Sol",
        "gynaecology",
        { centro: ["general_practice"] },
      ),
    ).toBeUndefined();
  });
});
