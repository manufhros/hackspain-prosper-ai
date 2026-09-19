import { expect, test } from "bun:test";
import { Consent } from "../src/voice/consent";
import { type ConsentChoice, type ConsentDecision, type ConsentInput, type DecideConsent } from "../src/voice/consent-decision";
import { type Action } from "../src/data";

const action: Action = { action: "BOOK", patient_id: "P1", provider_id: "PR01", location_id: "centro", slot: "2026-09-22T09:00:00+02:00", appointment_type_id: "review", policy_id: "mapfre" };
const signal = () => new AbortController().signal;
const result = (choice: ConsentChoice, probability = 0.99): ConsentDecision => ({ choice, probability, confidence: 0.99, elapsed_ms: 2, model: "fake-decision" });
const decide = (choice: ConsentChoice, probability = 0.99): DecideConsent => async () => result(choice, probability);
const hear = (consent: Consent, choice: ConsentChoice, text = "caller reply", probability = 0.99) => consent.hear(text, [], decide(choice, probability), signal());

test("model acceptance grants only the exact delivered action without a phrase whitelist", async () => {
  for (const reply of ["Perfecto, muy bien.", "Que sí, coño, que me viene muy bien eso, sí.", "An arbitrary reply classified by the model"]) {
    const consent = new Consent(); consent.offer([action], true);
    await hear(consent, "accept", reply);
    expect(() => consent.check([action])).not.toThrow();
    expect(() => consent.check([{ ...action, patient_id: "P2" }])).toThrow();
    expect(() => consent.check([{ ...action, slot: "2026-09-22T10:00:00+02:00" }])).toThrow();
    expect(() => consent.check([{ ...action, slot: new Date(String(action.slot)).toISOString() }])).not.toThrow();
  }
});
test("decline, corrections, questions, other replies and uncertain acceptance cannot grant consent", async () => {
  for (const choice of ["decline", "change", "clarify", "other"] as const) {
    const consent = new Consent(); consent.offer([action], true);
    await hear(consent, choice, "Yes"); // Model meaning wins over the literal affirmative word.
    expect(() => consent.check([action])).toThrow("explicitly accepted");
  }
  const consent = new Consent(); consent.offer([action], true);
  await hear(consent, "accept", "Yes", 0.6);
  expect(consent.hasAccepted([action])).toBe(false);
});
test("unheard, interrupted, and clarification-blocked offers cannot be accepted even by a confident model", async () => {
  const consent = new Consent(); consent.offer([action], false);
  await hear(consent, "accept"); expect(consent.hasAccepted([action])).toBe(false);
  consent.delivered(); await hear(consent, "accept"); expect(consent.hasAccepted([action])).toBe(false);
  consent.offer([action], true); consent.interrupt(); await hear(consent, "accept"); expect(consent.hasAccepted([action])).toBe(false);
  consent.offer([action], true); await hear(consent, "clarify");
  consent.delivered(); await hear(consent, "accept"); expect(consent.hasAccepted([action])).toBe(false);
  consent.offer([action], false); consent.delivered(); await hear(consent, "accept"); expect(consent.hasAccepted([action])).toBe(true);
});
test("accepted actions survive unrelated replies and an accepted cancellation, but not corrections", async () => {
  const consent = new Consent(), cancel = { action: "CANCEL", appointment_id: "A2" };
  consent.offer([action], true); await hear(consent, "accept"); await hear(consent, "other");
  consent.offer([cancel], true); await hear(consent, "accept", "Sí, confirmo la cancelación.");
  expect(() => consent.check([action, cancel])).not.toThrow();
  await hear(consent, "change"); expect(consent.acceptedActions).toEqual([]);
});
test("declining a new offer preserves prior intents; withdrawing prior agreement revokes them", async () => {
  const consent = new Consent(); consent.offer([action], true); await hear(consent, "accept");
  consent.offer([{ action: "CANCEL", appointment_id: "A2" }], true); await hear(consent, "decline");
  expect(consent.hasAccepted([action])).toBe(true);
  await hear(consent, "decline"); expect(consent.acceptedActions).toEqual([]);
});
test("model receives the grounded offer, spoken names, delivery state, and bounded history", async () => {
  const consent = new Consent(); consent.offer([action], true, "Dr. Emilio Iglesia", "Arenal Centro", "Tuesday at nine. Does that suit you?");
  let captured: ConsentInput | undefined;
  await consent.hear("Perfecto, muy bien.", Array.from({ length: 9 }, (_, i) => ({ role: "caller", text: String(i) })), async input => {
    captured = input; return result("accept");
  }, signal());
  expect(captured!.pending).toMatchObject({ actions: [action], delivered: true, provider: "Dr. Emilio Iglesia", speech: "Tuesday at nine. Does that suit you?" });
  expect(captured!.conversation).toHaveLength(6);
  expect(captured!.reply).toBe("Perfecto, muy bien.");
});
test("a failed decision cannot silently retain permission or fall back to matching yes", async () => {
  const consent = new Consent(); consent.offer([action], true); await hear(consent, "accept");
  await expect(consent.hear("Yes", [], async () => { throw new Error("Decision timeout"); }, signal())).rejects.toThrow("Decision timeout");
  expect(consent.acceptedActions).toEqual([]);
});
test("late decisions after cancellation or replacement cannot authorize the old or new action", async () => {
  for (const kind of ["abort", "interrupt", "replace"] as const) {
    const consent = new Consent(); consent.offer([action], true);
    const abort = new AbortController();
    let resolve!: (decision: ConsentDecision) => void;
    const work = consent.hear("Yes", [], () => new Promise(done => resolve = done), abort.signal);
    if (kind === "abort") abort.abort(new Error("Interrupted"));
    if (kind === "interrupt") consent.interrupt();
    if (kind === "replace") consent.offer([{ ...action, policy_id: "axa" }], true);
    resolve(result("accept"));
    if (kind === "abort") await expect(work).rejects.toThrow("Interrupted"); else await work;
    expect(consent.acceptedActions).toEqual([]);
  }
});
test("no decision call is needed before any offer or for consent-free emergency actions", async () => {
  const consent = new Consent();
  await consent.hear("Yes", [], async () => { throw new Error("Unexpected model call"); }, signal());
  expect(() => consent.check([{ action: "ESCALATE", reason: "medical_emergency" }])).not.toThrow();
  expect(() => consent.check([action])).toThrow();
});
