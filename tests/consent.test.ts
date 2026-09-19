import { expect, test } from "bun:test";
import { Consent, acceptsOffer } from "../src/voice/consent";
import { type Action } from "../src/data";

const action: Action = { action: "BOOK", patient_id: "P1", provider_id: "PR01", location_id: "centro", slot: "2026-09-19T11:00:00+02:00", appointment_type_id: "review", policy_id: "mapfre" };

const cancellation: Action = { action: "CANCEL", appointment_id: "A2" };
const montoro: Action = { ...action, provider_id: "PR11", slot: "2026-09-29T09:15:00+02:00", policy_id: "dkv" };
const montoroReplies = [
  "Sí, perfecto. Es exactamente lo que pedía. Confírmela, por favor, con facturación a mi plan de KV.",
  "Me viene bien. Confírmela, por favor. Martes 29 de septiembre de 2026 a las 9.15 con la doctora Isabel Montoro en Arenal Centro y facturada Mi Plan DKV.",
];
test("composed confirmations validate every echoed offer detail instead of requiring a short yes", () => {
  for (const text of [...montoroReplies,
    "Yes, that's exactly what I wanted. Confirm it, please. Tuesday 29 September 2026 at 9:15 with Dr. Isabel Montoro at Arenal Centro billed to my plan DKV.",
    "Sí, perfecte. És exactament el que demanava. Confirmi-la, si us plau. Dimarts 29 de setembre de 2026 a les 9:15 amb la doctora Isabel Montoro a Arenal Centro amb facturació a el meu pla DKV.",
    "Me viene bien. Confírmela, por favor.",
  ]) {
    const consent = new Consent(); consent.offer([montoro], true, "Dra. Isabel Montoro", "Arenal Centro"); consent.hear(text);
    expect(consent.hasAccepted([montoro])).toBe(true);
    expect(consent.awaitingReoffer).toBeUndefined();
  }
});
test("restatements never authorize a changed slot, provider, site, insurer, condition or additional intent", () => {
  for (const text of [
    montoroReplies[1]!.replace("9.15", "9.45"), montoroReplies[1]!.replace("29 de", "30 de"),
    montoroReplies[1]!.replace("Martes", "Miércoles"), montoroReplies[1]!.replace("septiembre", "octubre"),
    montoroReplies[1]!.replace("2026", "2027"), montoroReplies[1]!.replace("Isabel Montoro", "Carmen Ortiz"),
    montoroReplies[1]!.replace("Centro", "Sur"), montoroReplies[1]!.replace("DKV", "AXA"),
    montoroReplies[0]!.replace("de KV", "Sanitas"),
    "Sí, perfecto, pero solo si no hay coste.", "Me viene bien. Confírmela y cancele mi otra cita.",
    "Sí, perfecto. Confírmela para mi hija.", "Sí, perfecto. Confírmela, por favor, si está cubierta.",
    "Por favor. Martes 29 de septiembre de 2026 a las 9.15.",
    montoroReplies[1] + " ¿Es la primera disponible?",
  ]) {
    const consent = new Consent(); consent.offer([montoro], true, "Dra. Isabel Montoro", "Arenal Centro"); consent.hear(text);
    expect(consent.hasAccepted([montoro])).toBe(false);
  }
});
test("detailed acceptance still requires delivered offer and exact known labels", () => {
  for (const text of montoroReplies) {
    const consent = new Consent(); consent.offer([montoro], false, "Dra. Isabel Montoro", "Arenal Centro"); consent.hear(text);
    expect(consent.hasAccepted([montoro])).toBe(false);
    consent.delivered(); consent.hear(text); expect(consent.hasAccepted([montoro])).toBe(false);
    consent.offer([montoro], true, "Dra. Isabel Montoro", "Arenal Centro"); consent.interrupt(); consent.hear(text);
    expect(consent.hasAccepted([montoro])).toBe(false);
  }
  const unknownNames = new Consent(); unknownNames.offer([montoro], true); unknownNames.hear(montoroReplies[1]!);
  expect(unknownNames.hasAccepted([montoro])).toBe(false);
  const wrongPolicy = new Consent(); wrongPolicy.offer([{ ...montoro, policy_id: "axa" }], true); wrongPolicy.hear(montoroReplies[0]!);
  expect(wrongPolicy.acceptedActions).toEqual([]);
});
const cancellationReplies = [
  "Sí, correcto. Esa es la cita que quiero cancelar.",
  "me viene bien. Confirmo la cancelación de esa cita.",
  "Sí, quiero cancelar esa cita.", "Confirmo la cancelación.",
  "Yes, that's the appointment I want to cancel.", "Yes, please cancel it.", "I confirm the cancellation of that appointment.",
  "Sí, correcte. Aquesta és la visita que vull cancel·lar.", "Confirmo la cancel·lació d'aquesta visita.",
];
test("natural cancellation replies accept only the delivered cancellation and retain other accepted intents", () => {
  for (const text of cancellationReplies) {
    const consent = new Consent(); consent.offer([action], true); consent.hear("Yes");
    consent.offer([cancellation], true); consent.hear(text);
    expect(consent.hasAccepted([action, cancellation])).toBe(true);
    expect(consent.hasAccepted([{ ...cancellation, appointment_id: "other" }])).toBe(false);
    expect(consent.awaitingReoffer).toBeUndefined();
    const booking = new Consent(); booking.offer([action], true); booking.hear(text);
    expect(booking.hasAccepted([action])).toBe(false);
  }
});
test("cancellation acceptance cannot bypass playback, clarification or interruption", () => {
  for (const text of cancellationReplies) {
    const consent = new Consent(); consent.offer([cancellation], false); consent.hear(text);
    expect(consent.hasAccepted([cancellation])).toBe(false);
    consent.delivered(); consent.hear(text); expect(consent.hasAccepted([cancellation])).toBe(false);
    consent.offer([cancellation], true); consent.interrupt(); consent.hear(text);
    expect(consent.hasAccepted([cancellation])).toBe(false);
    const fresh = new Consent(); fresh.hear(text); expect(fresh.hasAccepted([cancellation])).toBe(false);
  }
});
test("cancellation refusals, conditions, different appointments and extra intents stay unconfirmed", () => {
  for (const text of ["No quiero cancelar esa cita.", "Don't cancel it.", "Sí, pero quiero cancelar otra cita.",
    "Confirmo la cancelación de esa cita si no hay coste.", "Please cancel it if there is no fee.",
    "Yes, please cancel my other appointment.", "Sí, quiero cancelar esa cita y reservar otra.",
    "¿Confirmo la cancelación?", "Espera, esa no es la cita que quiero cancelar.", "No vull cancel·lar aquesta visita."]) {
    const consent = new Consent(); consent.offer([cancellation], true); consent.hear(text);
    expect(consent.hasAccepted([cancellation])).toBe(false);
  }
});

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


test("reported natural confirmations accept only the matching appointment", () => {
  expect(acceptsOffer("Yes, that works for me.")).toBe(true);
  expect(acceptsOffer("Ah, okay, yes, that works for me.")).toBe(true);
  const monday = { ...action, slot: "2026-09-21T09:00:00+02:00" };
  for (const [text, accepted] of [
    ["Ah, okay, yes, please book me for Monday at 9 with Dr. Martin.", true],
    ["Please book me for Monday at 9:00 with Dr. Martin.", true],
    ["Please book me for Tuesday at 9 with Dr. Martin.", false],
    ["Please book me for Monday at 10 with Dr. Martin.", false],
    ["Please book me for Monday at 9 with Dr. Carmen.", false],
    ["Please book me for Monday at 9 with Dr. Martin and cancel my other appointment.", false],
    ["Yes, that works for me, but only if it is free.", false],
  ] as const) {
    const consent = new Consent(); consent.offer([monday], true, "Dr. Martín Sáez"); consent.hear(text);
    expect(consent.hasAccepted([monday])).toBe(accepted);
  }
});

test("clarifications preserve a proposal without accepting yes to an unrelated question", () => {
  const consent = new Consent(); consent.offer([action], true);
  consent.hear("Is that the earliest?");
  expect(consent.awaitingReoffer?.actions).toEqual([action]);
  consent.delivered(); // an ordinary question about identity or preferences
  consent.hear("Yes"); expect(consent.hasAccepted([action])).toBe(false);
  consent.offer([action], false); consent.delivered(); consent.hear("Yes, that works for me.");
  expect(consent.acceptedActions).toEqual([action]);
});


test("common affirmative phrases work without accepting conditions or new intents", () => {
  for (const text of ["Yes, sounds good.", "That's fine.", "Go ahead.", "Sí, adelante.", "De acuerdo.", "Sí, me parece bien.", "D'acord.", "Sí, endavant."])
    expect(acceptsOffer(text)).toBe(true);
  for (const text of ["Sounds good, but a different day.", "Go ahead if my insurance covers it.", "Sí, adelante, pero con otro médico.", "De acuerdo, y otra cita."])
    expect(acceptsOffer(text)).toBe(false);
});

test("equivalent timestamp formatting preserves consent without accepting a different instant", () => {
  const consent = new Consent(); consent.offer([action], true); consent.hear("Yes");
  expect(() => consent.check([{ ...action, slot: new Date(String(action.slot)).toISOString() }])).not.toThrow();
  expect(() => consent.check([{ ...action, slot: "2026-09-19T11:00:00Z" }])).toThrow();
});
