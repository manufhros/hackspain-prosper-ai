import { expect, test } from "bun:test";
import { Consent, acceptsOffer } from "../src/voice/consent";
import { type Action } from "../src/data";

const action: Action = { action: "BOOK", patient_id: "P1", provider_id: "PR01", location_id: "centro", slot: "2026-09-19T11:00:00+02:00", appointment_type_id: "review", policy_id: "mapfre" };

test("clarification questions and unfinished requests from platform reports are not consent", () => {
  for (const text of ["Did you say September 19th at 11 or at 12?", "for my Overdue yearly checkup.", "Um, I'd like the soonest one available, please. Which of those is earliest?", "Yeah, so...", "Yes, but a different doctor", "Not that one", "Yes?", "¿Cuál es la primera?", "si hay otra cita", "No", "please"]) {
    expect(acceptsOffer(text)).toBe(false);
    const consent = new Consent(); consent.offer([action], true); consent.hear(text);
    expect(() => consent.check([action])).toThrow("not been offered");
  }
});
test("short natural acceptances work in all three supported languages", () => {
  for (const text of ["Yes", "Yes, please", "Yes, please book that slot.", "That works", "I'll take it", "Sí", "Vale", "Perfecto", "Sí, esa opción me parece perfecta.", "Sí, me viene muy bien", "Perfecte", "Sí, em va bé"]) expect(acceptsOffer(text)).toBe(true);
});
test("acceptance requires completed delivery and only authorizes the exact proposed action", () => {
  const consent = new Consent(); consent.offer([action], false); consent.hear("Yes");
  expect(() => consent.check([action])).toThrow();
  consent.offer([action], false); consent.delivered(); consent.hear("Yes");
  expect(() => consent.check([action])).not.toThrow();
  expect(() => consent.check([{ ...action, slot: "2026-09-19T12:00:00+02:00" }])).toThrow();
  expect(() => consent.check([{ ...action, patient_id: "P2" }])).toThrow();
});
test("interruption discards an unheard offer and corrections revoke prior consent", () => {
  const consent = new Consent(); consent.offer([action], false); consent.interrupt(); consent.hear("Yes");
  expect(() => consent.check([action])).toThrow();
  consent.offer([action], true); consent.hear("Yes"); consent.hear("Wait, a different day please");
  expect(() => consent.check([action])).toThrow();
});
test("accepted intents survive other questions and payload repairs; emergencies need no consent", () => {
  const consent = new Consent(); consent.offer([action], true); consent.hear("Yes");
  consent.hear("What time do you open?");
  const cancel: Action = { action: "CANCEL", appointment_id: "A2" };
  consent.offer([cancel], true); consent.hear("Yes");
  expect(() => consent.check([action, cancel])).not.toThrow();
  expect(() => new Consent().check([{ action: "ESCALATE", reason: "medical_emergency" }])).not.toThrow();
});

test("a spoken day/time acceptance must match the offered Madrid slot exactly", () => {
  for (const text of ["El 19 a las 11 está bien.", "The 19th at 11 works."]) {
    const consent = new Consent(); consent.offer([action], true); consent.hear(text);
    expect(() => consent.check([action])).not.toThrow();
  }
  for (const text of ["El 19 a las 12 está bien.", "The 20th at 11 works.", "The 19th at 11:15 works."]) {
    const consent = new Consent(); consent.offer([action], true); consent.hear(text);
    expect(() => consent.check([action])).toThrow();
  }
});
