import { describe, expect, test } from "bun:test";
import { createCallState, type AvailabilitySlot } from "../state/call-state";
import { buildBookPayload, chooseOffer } from "./booking";

const slot: AvailabilitySlot = {
  provider_id: "PR01",
  provider_name: "Dra. Carmen Ortiz Vidal",
  specialty_id: "general_practice",
  location_id: "centro",
  appointment_type_id: "review",
  start_time: "2099-09-21T09:00:00+02:00",
  duration_minutes: 15,
  payable_with: ["mapfre"],
};

function readyState() {
  const state = createCallState("CA123", "+34600000000");
  state.turn = 2;
  state.resolvedPatientId = "P00001";
  state.constraints = {
    specialtyId: "general_practice",
    locationId: "centro",
    insurer: "mapfre",
  };
  state.knownPatients = [
    {
      patient_id: "P00001",
      given_name: "Josefa",
      first_surname: "Domínguez",
      second_surname: "Navarro",
      national_id: "48064716Y",
      date_of_birth: "2001-09-19",
      phone: "711330529",
      has_visited_before: true,
      insurer: "mapfre",
      referrals: [],
      note: "",
      match_score: 1,
      matched_fields: ["phone"],
    },
  ];
  state.lastAvailability = {
    patientId: "P00001",
    slots: [slot],
    blocked: [],
    searchedAtTurn: 2,
    constraintsVersion: 0,
  };
  state.offer = chooseOffer(state, [slot]);
  return state;
}

describe("booking invariants", () => {
  test("builds exact IDs only from the API slot", () => {
    const state = readyState();
    state.turn += 1;
    expect(buildBookPayload(state)).toEqual({
      call_id: "CA123",
      patient_id: "P00001",
      provider_id: "PR01",
      location_id: "centro",
      appointment_type_id: "review",
      slot: "2099-09-21T09:00:00+02:00",
      policy_id: "mapfre",
    });
  });

  test("rejects booking in the same turn as the offer", () => {
    const state = readyState();
    expect(() => buildBookPayload(state)).toThrow("later caller turn");
  });

  test("rejects an offer after constraints change", () => {
    const state = readyState();
    state.turn += 1;
    state.constraintsVersion += 1;
    expect(() => buildBookPayload(state)).toThrow("stale");
  });

  test("filters slots that violate location", () => {
    const state = readyState();
    state.constraints.locationId = "sur";
    expect(() => chooseOffer(state, [slot])).toThrow("No slot matches");
  });
});
