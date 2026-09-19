import { expect, test } from "bun:test";
import { simulatedCallerMessages } from "../src/simulation/scenario";
import { now, slot, scenario } from "./helpers/simulation";

test("random scenario uses live eligible slots and fresh IDs rather than archived answers", async () => {
  const generated = await scenario();
  expect(generated.case.expected.acceptable[0]!.actions).toEqual([{ action: "BOOK", patient_id: "P-live", provider_id: "PR-live",
    location_id: "centro", appointment_type_id: "review", slot: slot.start_time, policy_id: "mapfre" }]);
  expect(await scenario()).toEqual(generated);
  expect((await scenario("book", { start: "2026-09-23T11:00:00+02:00" })).case.expected.acceptable).not.toEqual(generated.case.expected.acceptable);
  expect(generated.case.reference_time).toBe(now);
});
test("cancellation and rescheduling oracle uses a live future appointment", async () => {
  expect((await scenario("cancel")).case.expected.acceptable[0]!.actions).toEqual([{ action: "CANCEL", appointment_id: "A-live" }]);
  expect((await scenario("reschedule")).case.expected.acceptable[0]!.actions).toEqual([{ action: "RESCHEDULE", appointment_id: "A-live",
    provider_id: "PR-live", location_id: "centro", slot: slot.start_time, policy_id: "mapfre" }]);
  await expect(scenario("cancel", { expiredAppointment: true })).rejects.toThrow("No eligible");
});
test("empty, expired and same-day availability never produce fabricated expected bookings", async () => {
  await expect(scenario("book", { empty: true })).rejects.toThrow("No eligible");
  await expect(scenario("book", { end: "2026-09-18" })).rejects.toThrow("calendar ended");
  await expect(scenario("book", { start: "2026-09-19T15:00:00+02:00" })).rejects.toThrow("No eligible");
});
test("caller knows identity and preferences but never oracle, source IDs or tools", async () => {
  const generated = await scenario();
  generated.case.expected.acceptable[0]!.actions[0]!.secret = "ORACLE_SENTINEL";
  const prompt = JSON.stringify(simulatedCallerMessages(generated.case));
  expect(prompt).toContain("Dra. Actual"); expect(prompt).toContain("Persona");
  for (const hidden of ["ORACLE_SENTINEL", "P-live", "PR-live", "appointment_type_id", "payable_with", "acceptable"]) expect(prompt).not.toContain(hidden);
});
