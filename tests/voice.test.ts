import { expect, test } from "bun:test";
import { cases, type ObjectValue, type Outcome } from "../src/data";
import { evaluateBatch, parseResults } from "../src/evaluate";
import { Receptionist, agentTools, readEndpoints, type ClinicReader } from "../src/voice/agent";
import { callerMessages, resultFromRehearsal, runRehearsal, spokenRoundtrip, voiceSmoke, wordErrorRate } from "../src/voice/rehearsal";
import { type Inference, type Message } from "../src/voice/runtime";

const signal = () => new AbortController().signal;
const say = (content: string): Message => ({ role: "assistant", content });
const call = (name: string, args: ObjectValue): Message => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
class FakeInference implements Inference {
  seen: { messages: Message[]; tools: unknown[]; format: unknown }[] = [];
  audioCalls: { operation: string; fields: ObjectValue }[] = [];
  removed: string[] = [];
  speech = new Map<string, string>();
  failTranscription = false;
  constructor(public replies: Message[] = []) {}
  async chat(messages: Message[], tools: unknown[], abort: AbortSignal, format?: unknown) {
    abort.throwIfAborted(); this.seen.push({ messages: structuredClone(messages), tools, format });
    const message = this.replies.shift();
    if (!message) throw new Error("Fake model exhausted");
    return { message, elapsed_ms: 3 };
  }
  async audio(operation: string, fields: ObjectValue, abort: AbortSignal) {
    abort.throwIfAborted(); this.audioCalls.push({ operation, fields });
    const file = String(fields.file);
    if (operation === "speak") { this.speech.set(file, String(fields.text)); return { file, duration_ms: 1000, elapsed_ms: 2 }; }
    if (this.failTranscription) throw new Error("Transcription failed");
    return { text: this.speech.get(file) ?? "", elapsed_ms: 1 };
  }
  async removeAudio(file: string) { this.removed.push(file); this.speech.delete(file); }
}
const noClinic: ClinicReader = { async request() { throw new Error("Unexpected clinic access"); } };
const bookCase = cases.find(c => c.expected.acceptable[0]?.actions[0]?.action === "BOOK")!;
const booking = bookCase.expected.acceptable[0]!;
const action = booking.actions[0]!;
const slot = { ...action, start_time: action.slot, payable_with: [action.policy_id] };
function clinicFixture() {
  const requests: string[] = [];
  const clinic: ClinicReader = { async request(request) {
    expect(request.method).toBe("GET"); requests.push(request.path);
    const data = request.path.includes("/directory?") ? { matches: [{ patient_id: action.patient_id }] }
      : request.path.includes("/availability?") ? { slots: [slot] }
      : { appointments: [{ appointment_id: "A-future", patient_id: action.patient_id, start_time: action.slot },
        { appointment_id: "A-past", patient_id: action.patient_id, start_time: "2026-09-01T10:00:00+02:00" }] };
    return { status: 200, elapsed_ms: 1, meaning: "OK", data };
  } };
  return { clinic, requests };
}
const directory = () => call("directory", { name: "Patient", date_of_birth: "1980-01-01" });
const availability = (patient = action.patient_id) => call("availability", { date_from: "2026-09-19", date_to: "2026-09-25", provider_id: action.provider_id, patient_id: patient });
const complete = (record: Outcome) => call("complete_call", { record });

test("agent tool surface only exposes clinic GETs and a local completion sink", () => {
  expect(readEndpoints.length).toBe(9);
  expect(readEndpoints.every(e => e.method === "GET" && !e.path.includes("submissions"))).toBe(true);
  expect(agentTools.map(t => t.function.name)).not.toContain("submissions");
  expect(JSON.stringify(agentTools)).not.toContain("$ref");
});
test("agent accepts a booking only from observed, patient-specific clinic availability", async () => {
  const { clinic, requests } = clinicFixture();
  const inference = new FakeInference([directory(), availability(), complete(booking), say("Confirmed.")]);
  const agent = new Receptionist(inference, clinic, bookCase.reference_time, "en");
  expect(await agent.turn("Yes, please book that slot.", signal())).toBe("Confirmed.");
  expect(agent.record).toEqual(booking);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContain(`patient_id=${action.patient_id}`);
  expect(agent.messages.find(m => m.role === "tool" && m.tool_name === "complete_call")?.content).toContain('"platform_submission":false');
});
test("invented patients, other patients' slots and unreturned policies cannot be completed", async () => {
  for (const scenario of ["no_directory", "wrong_patient", "wrong_policy"]) {
    const record = structuredClone(booking);
    if (scenario === "wrong_policy") record.actions[0]!.policy_id = "self_pay";
    const inference = new FakeInference([
      ...(scenario === "no_directory" ? [] : [directory()]),
      availability(scenario === "wrong_patient" ? "P-other" : action.patient_id), complete(record), say("I need to check again."),
    ]);
    const agent = new Receptionist(inference, clinicFixture().clinic, bookCase.reference_time, "en");
    await agent.turn("Book it", signal());
    expect(agent.record).toBeUndefined();
    expect(agent.messages.find(m => m.tool_name === "complete_call")?.content).toContain("error");
  }
});
test("cancellation requires an observed upcoming appointment and sessions stay isolated", async () => {
  const inference = new FakeInference([call("appointments", { patient_id: action.patient_id }),
    complete({ actions: [{ action: "CANCEL", appointment_id: "A-past" }] }), say("That visit is past."),
    complete({ actions: [{ action: "CANCEL", appointment_id: "A-future" }] }), say("Cancelled locally.")]);
  const agent = new Receptionist(inference, clinicFixture().clinic, bookCase.reference_time, "en");
  await agent.turn("Cancel the old visit", signal()); expect(agent.record).toBeUndefined();
  await agent.turn("Then cancel the future visit", signal()); expect(agent.record?.actions[0]?.appointment_id).toBe("A-future");
  const fresh = new Receptionist(new FakeInference([complete({ actions: [{ action: "CANCEL", appointment_id: "A-future" }] }), say("I must look it up.")]), noClinic, bookCase.reference_time, "en");
  await fresh.turn("Cancel it", signal()); expect(fresh.record).toBeUndefined();
});
test("unknown submission tools and clinic errors return recoverable tool errors", async () => {
  let count = 0;
  const clinic: ClinicReader = { async request() { count++; return { status: 403, meaning: "Invalid key", elapsed_ms: 1, data: {} }; } };
  const inference = new FakeInference([call("submit_book", {}), directory(), say("I cannot access the clinic.")]);
  const agent = new Receptionist(inference, clinic, bookCase.reference_time, "en");
  await agent.turn("Help", signal());
  expect(count).toBe(1); expect(agent.record).toBeUndefined();
  expect(agent.messages.filter(m => m.role === "tool").every(m => m.content.includes("error"))).toBe(true);
});
test("caller and receptionist contexts never receive expected or protected answer oracles", () => {
  const item = structuredClone(bookCase);
  item.expected = { acceptable: [{ actions: [{ action: "SECRET_EXPECTED_SENTINEL" }] }] };
  item.protected = [{ kind: "phone", value: "SECRET_PROTECTED_SENTINEL" }];
  const caller = JSON.stringify(callerMessages(item));
  expect(caller).toContain(item.caller_prompt.slice(0, 20));
  expect(caller).not.toContain("SECRET_");
  const agent = new Receptionist(new FakeInference(), noClinic, item.reference_time, item.language);
  expect(JSON.stringify(agent.messages)).not.toContain(item.persona.name);
});
test("automated rehearsal routes both voices through audio and exports a local result", async () => {
  const item = cases.find(c => c.expected.acceptable[0]?.actions[0]?.action === "NO_ACTION")!;
  const inference = new FakeInference([say("How can I help?"), say("Only Dr Fuentes, please."), complete(item.expected.acceptable[0]!), say("That provider is unavailable.")]);
  const report = await runRehearsal(inference, noClinic, item, signal(), () => {});
  expect(report.error).toBeUndefined(); expect(report.evaluation.status).toBe("pass");
  expect(inference.audioCalls.filter(c => c.operation === "speak")).toHaveLength(3);
  expect(inference.audioCalls.filter(c => c.operation === "transcribe")).toHaveLength(3);
  expect(inference.removed).toHaveLength(3);
  expect(inference.audioCalls.every(c => c.operation !== "speak" || c.fields.telephone === true)).toBe(true);
  expect(inference.seen[1]!.tools).toHaveLength(0); // caller has no clinic tools
  expect(evaluateBatch(parseResults([resultFromRehearsal(report)])).passed).toBe(1);
});
test("audio failure after a matching record cannot pass, including on export/reimport", async () => {
  const item = cases.find(c => c.expected.acceptable[0]?.actions[0]?.action === "NO_ACTION")!;
  const inference = new FakeInference([complete(item.expected.acceptable[0]!), say("Done")]);
  inference.failTranscription = true;
  const report = await runRehearsal(inference, noClinic, item, signal(), () => {});
  expect(report.record).toEqual(item.expected.acceptable[0]!);
  expect(report.evaluation.status).toBe("fail"); expect(inference.removed).toHaveLength(1);
  expect(evaluateBatch(parseResults([resultFromRehearsal(report)])).passed).toBe(0);
  expect(() => parseResults([{ ...resultFromRehearsal(report), execution_error: 2 }])).toThrow();
});
test("the last allowed caller turn still synthesizes the final confirmation", async () => {
  const item = cases.find(c => c.expected.acceptable[0]?.actions[0]?.action === "NO_ACTION")!;
  const replies = [say("Hello")];
  for (let turn = 0; turn < 23; turn++) replies.push(say("Please repeat"), say("Let me clarify"));
  replies.push(say("Yes"), complete(item.expected.acceptable[0]!), say("Final confirmation"));
  const inference = new FakeInference(replies);
  const report = await runRehearsal(inference, noClinic, item, signal(), () => {});
  expect(report.error).toBeUndefined();
  expect(inference.audioCalls.filter(c => c.operation === "speak").at(-1)?.fields.text).toBe("Final confirmation");
  expect(inference.replies).toHaveLength(0);
});
test("cancellation and microphone mode avoid the automatic caller", async () => {
  const abort = new AbortController(); abort.abort();
  const cancelled = await runRehearsal(new FakeInference(), noClinic, bookCase, abort.signal, () => {});
  expect(cancelled.error).toBeDefined(); expect(cancelled.evaluation.status).toBe("fail");
  const inference = new FakeInference([say("Hello")]);
  const report = await runRehearsal(inference, noClinic, bookCase, signal(), () => {}, async () => null);
  expect(report.mode).toBe("microphone"); expect(report.error).toContain("cancelled");
  expect(inference.seen).toHaveLength(1); expect(inference.audioCalls[0]!.fields.play).toBe(true);
});
test("temporary audio is removed after failed ASR and smoke checks measure each language", async () => {
  const broken = new FakeInference(); broken.failTranscription = true;
  await expect(spokenRoundtrip(broken, "hello", "en", signal(), () => {})).rejects.toThrow("Transcription failed");
  expect(broken.removed).toHaveLength(1);
  const inference = new FakeInference([say('{"ready":true,"languages":["en","es","ca"]}')]);
  const smoke = await voiceSmoke(inference, signal(), () => {});
  expect(smoke.model_ready).toBe(true); expect(smoke.speech.map(s => s.language)).toEqual(["en", "es", "ca"]);
  expect(smoke.speech.every(s => s.word_error_rate === 0)).toBe(true);
  expect(wordErrorRate("hola buenos días", "hola días")).toBeCloseTo(1 / 3);
});
