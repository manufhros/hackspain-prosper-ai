import assert from "node:assert/strict";
import { test } from "node:test";
import { actionToolBlocked, flushPendingSubmit, addYmd, alignSurnameWithEmail, asInsurer, asLocation, asProviderId, asSpecialty, clinicTodayYmd, clampDateRange, isAfterWork, normalizeRegisterEmail, normalizeRegisterPhone, rankAvailability, restoreRegisterName, runClinicTool, type CallContext } from "./tools.ts";
import type { PlatformClient } from "../platform/client.ts";

test("maps spoken specialty names to clinic ids", () => {
  assert.equal(asSpecialty("orthopedics"), "orthopaedics");
  assert.equal(asSpecialty("pediatrics"), "paediatrics");
  assert.equal(asSpecialty("gynecology"), "gynaecology");
  assert.equal(asSpecialty("gp"), "general_practice");
  assert.equal(asSpecialty("general_practice"), "general_practice");
});

test("maps insurer aliases", () => {
  assert.equal(asInsurer("Nueva Mutua Sanitaria"), "nueva_mutua");
  assert.equal(asInsurer("acesa"), "asisa");
  assert.equal(asInsurer("Mapfre Salud"), "mapfre");
  assert.equal(asInsurer("Cazé Salud"), "caser");
  assert.equal(asInsurer("KASIR"), "caser");
  assert.equal(asInsurer("Addislos"), "adeslas");
  assert.equal(asInsurer("adeslaz"), "adeslas");
  assert.equal(asInsurer("Sentas"), "sanitas");
  assert.equal(asProviderId("Iglesas"), "PR05");
  assert.equal(asProviderId("Lorente"), undefined);
  assert.equal(asLocation("sentro"), "centro");
  assert.equal(asSpecialty("dermatologia"), "dermatology");
});

test("restores register name accents and email spelling", () => {
  assert.equal(restoreRegisterName("Agustin"), "Agustín");
  assert.equal(restoreRegisterName("Vasquez"), "Vázquez");
  assert.equal(restoreRegisterName("Gutierrez"), "Gutiérrez");
  assert.equal(normalizeRegisterEmail("Agustin_Vasquez53@outlook.es"), "agustin_vazquez53@outlook.es");
  assert.equal(normalizeRegisterEmail("oscar_dominguez-13@gmail.com"), "oscar_dominguez13@gmail.com");
  assert.equal(normalizeRegisterPhone("609-688-3670"), "609688367");
  assert.equal(alignSurnameWithEmail("Hill", "anna.gill43@gmail.com"), "Gill");
});

test("maps garbled site names to clinic ids", () => {
  assert.equal(asLocation("SIR"), "sur");
  assert.equal(asLocation("Arenal Sur"), "sur");
  assert.equal(asLocation("Central Arnold"), "centro");
});

test("maps Iglesia vs Iglesias to different provider ids", () => {
  assert.equal(asProviderId("Dr. Iglesia"), "PR06");
  assert.equal(asProviderId("Dracha Iglesias"), "PR05");
  assert.equal(asProviderId("PR06"), "PR06");
  assert.equal(asProviderId("Dr. Sid"), "PR09");
  assert.equal(asProviderId("Cid"), "PR09");
  assert.equal(asProviderId("Lorente"), undefined);
  assert.equal(asProviderId("Quintero"), undefined);
});

test("keeps an explicit later date_from and caps the range at 14 days", () => {
  const kept = clampDateRange("2026-10-05", "2026-10-16");
  assert.equal(kept.date_from, "2026-10-05");
  assert.equal(kept.date_to, "2026-10-16");
  const first = addYmd(clinicTodayYmd(), 1);
  const capped = clampDateRange(first, addYmd(first, 40));
  assert.equal(capped.date_from, first);
  assert.equal(capped.date_to, addYmd(first, 13));
});

test("madrid_today is the calendar day in Europe/Madrid", () => {
  assert.equal(clinicTodayYmd(new Date("2026-09-18T21:00:00Z")), "2026-09-18");
  assert.equal(clinicTodayYmd(new Date("2026-09-18T23:04:00Z")), "2026-09-19");
  assert.equal(clinicTodayYmd(new Date("2026-09-19T07:00:00+02:00")), "2026-09-19");
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

test("search_availability without specialty or provider does not hit the API", async () => {
  const result = JSON.parse(
    await runClinicTool(
      ctx({
        availability: async () => {
          throw new Error("should not call availability");
        },
      }),
      "search_availability",
      { patient_id: "P00001" },
    ),
  );
  assert.equal(result.error, "need specialty_id or provider_id");
});

test("search_availability remaps orthopedics and fills dates", async () => {
  let query: { specialty_id?: string; date_from?: string; date_to?: string } = {};
  await runClinicTool(
    ctx({
      availability: async (q) => {
        query = q;
        return { providers: [], slots: [], blocked: [], appointment_type: { id: "review", name: "Review", duration_minutes: 30, new_patient_requirement: "none", guidance: "" } };
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
      slot: "2026-09-21T11:00:00+02:00",
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
    slot: "2026-09-21T11:00:00+02:00",
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
  assert.equal(ranked.soonest_sur?.start_time, "2026-09-21T09:00:00+02:00");
  assert.equal(ranked.soonest_centro?.start_time, "2026-09-21T09:15:00+02:00");
  assert.equal(ranked.slots[0]?.location_id, "sur");
  assert.equal(ranked.saturday[0]?.start_time, "2026-09-26T09:15:00+02:00");
  assert.equal(ranked.outside_hours_offer, null);
  assert.equal(ranked.after_work.length, 0);
  assert.equal(isAfterWork("2026-09-19T11:00:00+02:00"), false);
  assert.equal(isAfterWork("2026-09-21T16:00:00+02:00"), true);
  assert.match(ranked.staff ?? "", /Iglesia/);
});

test("sur_slots keeps later Sur days that the global cap would drop", () => {
  const slots = [];
  for (let hour = 9; hour < 16; hour += 1) {
    slots.push({
      provider_id: "PR01",
      provider_name: "Ortiz",
      specialty_id: "general_practice",
      location_id: "centro",
      appointment_type_id: "review",
      start_time: `2026-09-21T${String(hour).padStart(2, "0")}:00:00+02:00`,
      duration_minutes: 15,
      payable_with: ["cigna"],
    });
  }
  slots.push({
    provider_id: "PR10",
    provider_name: "Peral",
    specialty_id: "orthopaedics",
    location_id: "sur",
    appointment_type_id: "orthopaedic_review",
    start_time: "2026-09-21T09:30:00+02:00",
    duration_minutes: 15,
    payable_with: ["dkv"],
  });
  slots.push({
    provider_id: "PR10",
    provider_name: "Peral",
    specialty_id: "orthopaedics",
    location_id: "sur",
    appointment_type_id: "orthopaedic_review",
    start_time: "2026-09-24T09:00:00+02:00",
    duration_minutes: 15,
    payable_with: ["dkv"],
  });
  const ranked = rankAvailability({
    providers: [],
    blocked: [],
    appointment_type: {
      id: "orthopaedic_review",
      name: "Review",
      duration_minutes: 15,
      new_patient_requirement: "",
      guidance: "",
    },
    slots,
  });
  assert.equal(ranked.soonest_sur?.start_time, "2026-09-21T09:30:00+02:00");
  assert.equal(ranked.sur_slots[1]?.start_time, "2026-09-24T09:00:00+02:00");
});

test("Saturday morning is inside hours, not after-hours", () => {
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
        start_time: "2026-09-19T11:00:00+02:00",
        duration_minutes: 15,
        payable_with: ["cigna"],
      },
      {
        provider_id: "PR01",
        provider_name: "Ortiz",
        specialty_id: "general_practice",
        location_id: "centro",
        appointment_type_id: "review",
        start_time: "2026-09-19T12:00:00+02:00",
        duration_minutes: 15,
        payable_with: ["cigna"],
      },
    ],
  }, "2026-09-18");
  assert.equal(ranked.soonest?.start_time, "2026-09-19T11:00:00+02:00");
  assert.equal(ranked.outside_hours_offer, null);
  assert.equal(ranked.later_saturday[0]?.start_time, "2026-09-19T12:00:00+02:00");
});

test("unknown spoken doctor is provider_not_found without calling availability", async () => {
  let called = false;
  const result = JSON.parse(
    await runClinicTool(
      ctx({
        availability: async () => {
          called = true;
          return { providers: [], slots: [], blocked: [], appointment_type: { id: "x", name: "Test", duration_minutes: 30, new_patient_requirement: "none", guidance: "" } };
        },
      }),
      "search_availability",
      { patient_id: "P00001", provider_id: "Quintero", specialty_id: "orthopaedics" },
    ),
  );
  assert.equal(called, false);
  assert.equal(result.decline, "provider_not_found");
});

test("named provider drops specialty_id so Iglesia is not searched as GP", async () => {
  let query: { specialty_id?: string; provider_id?: string } = {};
  await runClinicTool(
    ctx({
      availability: async (q) => {
        query = q;
        return { providers: [], slots: [], blocked: [], appointment_type: { id: "review", name: "Review", duration_minutes: 30, new_patient_requirement: "none", guidance: "" } };
      },
    }),
    "search_availability",
    { patient_id: "P00001", provider_id: "Iglesia", specialty_id: "general_practice", insurer: "mapfre" },
  );
  assert.equal(query.provider_id, "PR06");
  assert.equal(query.specialty_id, undefined);
});

test("out_of_scope is held back for a known patient on the first turn", async () => {
  const context = ctx({
    submitNoAction: async () => {
      throw new Error("must not submit yet");
    },
  });
  context.knownPatient = true;
  context.userTurns = 1;
  const held = JSON.parse(
    await runClinicTool(context, "submit_no_action", { reason: "out_of_scope" }),
  );
  assert.equal(held.error, "do_not_submit_yet");
});

test("out_of_scope is allowed after a persistent off-desk request", async () => {
  const context = ctx({
    submitNoAction: async (payload) => ({
      call_id: payload.call_id,
      received_at: "t",
      record: { actions: [{ action: "NO_ACTION", reason: payload.reason }] },
    }),
  });
  context.userTurns = 3;
  const posted = JSON.parse(
    await runClinicTool(context, "submit_no_action", { reason: "out_of_scope" }),
  );
  assert.equal(posted.record.actions[0].reason, "out_of_scope");
});

test("second submit is blocked and no_availability remaps to provider_not_found", async () => {
  const context = ctx({
    submitNoAction: async (payload) => ({
      call_id: payload.call_id,
      received_at: "t",
      record: { actions: [{ action: "NO_ACTION", reason: payload.reason }] },
    }),
    submitBook: async () => {
      throw new Error("must not book after no_action");
    },
  });
  context.lastBlocked = "provider_not_found";
  const first = JSON.parse(
    await runClinicTool(context, "submit_no_action", { reason: "no_availability" }),
  );
  assert.equal(first.record.actions[0].reason, "provider_not_found");
  const second = JSON.parse(
    await runClinicTool(context, "submit_book", {
      patient_id: "P00001",
      provider_id: "PR01",
      location_id: "centro",
      appointment_type_id: "review",
      slot: "2026-09-19T11:00:00+02:00",
      policy_id: "mapfre",
    }),
  );
  assert.equal(second.error, "already submitted");
});

test("disabled agenda tools block every write and retain an audit entry", async () => {
  const events: string[] = [];
  const call = ctx({});
  call.routingMode = "enforce";
  call.actionTools = false;
  call.audit = async (type) => { events.push(type); };
  for (const name of ["submit_book", "submit_register", "submit_cancel", "submit_reschedule"]) {
    assert.equal(JSON.parse(await runClinicTool(call, name, {})).error, "action_tools_disabled");
  }
  assert.equal(call.submitted, undefined);
  assert.deepEqual(events, Array(4).fill("tool.blocked"));
});

test("disabled agenda tools preserve reads, escalation and shadow mode", async () => {
  let reads = 0;
  const call = ctx({ directory: async () => { reads++; return { matches: [] }; } });
  call.routingMode = "enforce";
  call.actionTools = false;
  await runClinicTool(call, "search_directory", { name: "Test" });
  assert.equal(reads, 1);
  for (const name of ["search_availability", "list_appointments", "submit_escalate", "submit_no_action"]) {
    assert.equal(actionToolBlocked(call, name), false);
  }
  call.routingMode = "shadow";
  assert.equal(actionToolBlocked(call, "submit_book"), false);
});

test("call-end booking flush cannot bypass disabled agenda tools", async () => {
  let writes = 0;
  const call = ctx({ submitBook: async () => { writes++; throw new Error("must not book"); } });
  call.routingMode = "enforce";
  call.actionTools = false;
  call.draftBook = {
    patient_id: "patient", provider_id: "provider", location_id: "centro",
    appointment_type_id: "visit", slot: "2026-09-21T10:00:00", policy_id: "sanitas",
  };
  await flushPendingSubmit(call);
  assert.equal(writes, 0);
  assert.equal(call.submitted, undefined);
  assert.equal(call.draftBook, undefined);
});
