import assert from "node:assert/strict";
import { test } from "node:test";
import { asLocation, asSpecialty, clinicTodayYmd, rankAvailability, runClinicTool, type CallContext } from "./tools.ts";
import type { PlatformClient } from "../platform/client.ts";

test("maps spoken specialty names to clinic ids", () => {
  assert.equal(asSpecialty("orthopedics"), "orthopaedics");
  assert.equal(asSpecialty("pediatrics"), "paediatrics");
  assert.equal(asSpecialty("gynecology"), "gynaecology");
  assert.equal(asSpecialty("gp"), "general_practice");
  assert.equal(asSpecialty("general_practice"), "general_practice");
});

test("maps garbled site names to clinic ids", () => {
  assert.equal(asLocation("SIR"), "sur");
  assert.equal(asLocation("Arenal Sur"), "sur");
  assert.equal(asLocation("Central Arnold"), "centro");
});

test("before 09:00 Madrid the answer sheet is still yesterday", () => {
  assert.equal(clinicTodayYmd(new Date("2026-09-18T23:04:00Z")), "2026-09-18");
  assert.equal(clinicTodayYmd(new Date("2026-09-19T07:00:00+02:00")), "2026-09-18");
  assert.equal(clinicTodayYmd(new Date("2026-09-19T09:00:00+02:00")), "2026-09-19");
});

function ctx(platform: Partial<PlatformClient>): CallContext {
  return {
    callId: "call-1",
    fromNumber: "+34711330529",
    platform: platform as PlatformClient,
  };
}

test("search_directory does not invent a phone from caller id", async () => {
  let query: unknown;
  const result = await runClinicTool(
    ctx({
      directory: async (q) => {
        query = q;
        return { matches: [] };
      },
    }),
    "search_directory",
    { name: "Josefa" },
  );
  assert.deepEqual(query, { name: "Josefa" });
  assert.equal(JSON.parse(result).matches.length, 0);
});

test("search_availability remaps orthopedics and fills dates", async () => {
  let query: { specialty_id?: string; date_from?: string; date_to?: string } = {};
  await runClinicTool(
    ctx({
      availability: async (q) => {
        query = q;
        return { providers: [], slots: [], blocked: [], appointment_type: { id: "review" } };
      },
    }),
    "search_availability",
    { patient_id: "P00001", specialty_id: "orthopedics", insurer: "mapfre" },
  );
  assert.equal(query.specialty_id, "orthopaedics");
  assert.match(query.date_from ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(query.date_to ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("submit_book attaches call_id and rejects incomplete payloads", async () => {
  const missing = JSON.parse(
    await runClinicTool(ctx({}), "submit_book", { patient_id: "P00001" }),
  );
  assert.equal(missing.error, "missing book fields");

  let body: unknown;
  const ok = await runClinicTool(
    ctx({
      submitBook: async (payload) => {
        body = payload;
        return { call_id: payload.call_id, received_at: "t", record: { actions: [] } };
      },
    }),
    "submit_book",
    {
      patient_id: "P00001",
      provider_id: "PR01",
      location_id: "centro",
      appointment_type_id: "review",
      slot: "2026-09-19T11:00:00+02:00",
      policy_id: "mapfre",
    },
  );
  assert.equal(JSON.parse(ok).call_id, "call-1");
  assert.deepEqual(body, {
    call_id: "call-1",
    patient_id: "P00001",
    provider_id: "PR01",
    location_id: "centro",
    appointment_type_id: "review",
    slot: "2026-09-19T11:00:00+02:00",
    policy_id: "mapfre",
  });
});

test("availability lists the globally earliest slot first and keeps Saturday", () => {
  const ranked = rankAvailability({
    providers: [],
    blocked: [],
    appointment_type: {
      id: "review",
      name: "Review",
      duration_minutes: 15,
      new_patient_requirement: "",
      guidance: "",
    },
    slots: [
      {
        provider_id: "PR01",
        provider_name: "Ortiz",
        specialty_id: "general_practice",
        location_id: "centro",
        appointment_type_id: "review",
        start_time: "2026-09-21T09:15:00+02:00",
        duration_minutes: 15,
        payable_with: ["asisa"],
      },
      {
        provider_id: "PR03",
        provider_name: "Saez",
        specialty_id: "general_practice",
        location_id: "sur",
        appointment_type_id: "review",
        start_time: "2026-09-21T09:00:00+02:00",
        duration_minutes: 15,
        payable_with: ["cigna"],
      },
      {
        provider_id: "PR01",
        provider_name: "Ortiz",
        specialty_id: "general_practice",
        location_id: "centro",
        appointment_type_id: "review",
        start_time: "2026-09-26T09:15:00+02:00",
        duration_minutes: 15,
        payable_with: ["cigna"],
      },
    ],
  });
  assert.equal(ranked.soonest?.start_time, "2026-09-21T09:00:00+02:00");
  assert.equal(ranked.soonest?.location_id, "sur");
  assert.equal(ranked.slots[0]?.location_id, "sur");
  assert.equal(ranked.saturday[0]?.start_time, "2026-09-26T09:15:00+02:00");
  assert.ok(!("providers" in ranked));
});

test("unknown tool returns an error json", async () => {
  const result = JSON.parse(await runClinicTool(ctx({}), "not_a_tool", {}));
  assert.equal(result.error, "unknown tool not_a_tool");
});
