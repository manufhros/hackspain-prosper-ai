import { expect, test } from "bun:test";
import { cases, type ObjectValue, type Outcome } from "../src/data";
import { evaluateBatch, parseResults } from "../src/evaluate";
import { Receptionist, agentTools, readEndpoints, type ClinicReader } from "../src/voice/agent";
import { callerMessages, resultFromRehearsal, runRehearsal, spokenRoundtrip, voiceSmoke, wordErrorRate } from "../src/voice/rehearsal";
import { type Inference, type Message } from "../src/voice/runtime";
import { completionSpeech } from "../src/voice/resolution";
import { runFreeConversation } from "../src/voice/free";

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
test("free conversation accepts arbitrary input, reads the clinic and ends without a case score", async () => {
  const inference = new FakeInference([say("Hola"), call("clinic", {}), say("We open at nine.")]);
  const requests: string[] = [];
  const clinic: ClinicReader = { async request(request) {
    expect(request.method).toBe("GET"); requests.push(request.path);
    return { status: 200, elapsed_ms: 1, meaning: "OK", data: { opening_hours: "09:00" } };
  } };
  const answers = ["What time do you open?", null];
  const before = Date.now();
  const report = await runFreeConversation(inference, clinic, "es", signal(), () => {}, async () => answers.shift()!);
  expect(report.status).toBe("ended"); expect(report.error).toBeUndefined();
  expect(report).not.toHaveProperty("case_id"); expect(report).not.toHaveProperty("evaluation");
  expect(report.record).toBeUndefined();
  expect(Date.parse(report.reference_time)).toBeGreaterThanOrEqual(before);
  expect(report.transcript).toEqual([{ role: "agent", text: "Hola" }, { role: "caller", text: "What time do you open?" }, { role: "agent", text: "We open at nine." }]);
  expect(requests).toEqual(["/api/v1/clinic"]);
  expect(inference.seen.every(c => c.tools.length > 0)).toBe(true); // no generated caller
  expect(inference.audioCalls.filter(c => c.operation === "speak").map(c => c.fields.language)).toEqual(["es", "en"]);
});
test("free conversations can continue beyond the scripted rehearsal turn cap", async () => {
  const inference = new FakeInference(Array.from({ length: 27 }, () => say("Anything else?")));
  let turn = 0;
  const report = await runFreeConversation(inference, noClinic, "en", signal(), () => {}, async () => turn++ < 26 ? "Another question" : null);
  expect(report.status).toBe("ended"); expect(report.transcript.filter(t => t.role === "caller")).toHaveLength(26);
});
test("free conversation records final actions locally and plays the final confirmation", async () => {
  const record = { actions: [{ action: "NO_ACTION", reason: "out_of_scope" }] };
  const inference = new FakeInference([say("Hello"), complete(record)]);
  const report = await runFreeConversation(inference, noClinic, "ca", signal(), () => {}, async () => "No appointment needed. Goodbye.");
  expect(report.status).toBe("completed"); expect(report.record).toEqual(record);
  expect(inference.audioCalls.filter(c => c.operation === "speak").at(-1)?.fields.text).toBe(completionSpeech("ca"));
});
test("free conversation cancellation and audio failures retain partial transcripts", async () => {
  const abort = new AbortController();
  const cancelled = await runFreeConversation(new FakeInference([say("Hello")]), noClinic, "en", abort.signal, () => {}, async () => { abort.abort(); return null; });
  expect(cancelled.status).toBe("cancelled"); expect(cancelled.transcript).toHaveLength(1);
  const broken = new FakeInference([say("Hello")]); broken.failTranscription = true;
  const failed = await runFreeConversation(broken, noClinic, "en", signal(), () => {}, async () => null);
  expect(failed.status).toBe("error"); expect(failed.error).toBe("Transcription failed");
  expect(failed.transcript).toHaveLength(1); expect(broken.removed).toHaveLength(1);
});
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
  const inference = new FakeInference([directory(), availability(), complete(booking)]);
  const agent = new Receptionist(inference, clinic, bookCase.reference_time, "en");
  expect(await agent.turn("Yes, please book that slot.", signal())).toBe(completionSpeech("en"));
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
    complete({ actions: [{ action: "CANCEL", appointment_id: "A-future" }] })]);
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
  const inference = new FakeInference([say("How can I help?"), say("Only Dr Fuentes, please."), complete(item.expected.acceptable[0]!)]);
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
  const inference = new FakeInference([complete(item.expected.acceptable[0]!)]);
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
  replies.push(say("Yes"), complete(item.expected.acceptable[0]!));
  const inference = new FakeInference(replies);
  const report = await runRehearsal(inference, noClinic, item, signal(), () => {});
  expect(report.error).toBeUndefined();
  expect(inference.audioCalls.filter(c => c.operation === "speak").at(-1)?.fields.text).toBe(completionSpeech(item.language));
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

test("a confirmed offer captures a grounded mock BOOK and closes without another model turn", async () => {
  const { clinic, requests } = clinicFixture();
  const inference = new FakeInference([directory(), availability(), say("¿Le viene bien esta cita?"), call("complete_call", booking)]);
  const agent = new Receptionist(inference, clinic, bookCase.reference_time, "es");
  expect(await agent.turn("Busco una cita.", signal())).toBe("¿Le viene bien esta cita?");
  expect(await agent.turn("Sí, esa opción me parece perfecta.", signal())).toBe(completionSpeech("es"));
  expect(agent.record).toEqual(booking);
  expect(inference.replies).toHaveLength(0); expect(inference.seen).toHaveLength(4);
  expect(requests.every(path => !path.includes("submit"))).toBe(true);
  const receipt = JSON.parse(agent.messages.find(m => m.tool_name === "complete_call")!.content);
  expect(receipt.record).toEqual(booking);
  expect(receipt.submission_preview[0].path).toBe("/api/v1/submit/book");
  await expect(agent.turn("Sí", signal())).rejects.toThrow("already completed");
});
test("successful completion preserves multiple actions and ignores trailing tools", async () => {
  const record = { actions: [{ action: "CANCEL", appointment_id: "A-future" }, { action: "NO_ACTION", reason: "out_of_scope" }] };
  const completion = call("complete_call", record);
  completion.tool_calls!.push({ function: { name: "clinic", arguments: {} } });
  const { clinic, requests } = clinicFixture();
  const inference = new FakeInference([call("appointments", { patient_id: action.patient_id }), completion]);
  const agent = new Receptionist(inference, clinic, bookCase.reference_time, "en");
  await agent.turn("Cancel that visit and leave the other request.", signal());
  expect(agent.record).toEqual(record); expect(requests).toHaveLength(1);
});
test("repeated invalid completion stops locally instead of asking for endless confirmations", async () => {
  const inference = new FakeInference(Array.from({ length: 10 }, () => call("complete_call", { record: {} })));
  const agent = new Receptionist(inference, noClinic, bookCase.reference_time, "es");
  await expect(agent.turn("Sí", signal())).rejects.toThrow("Local resolution failed after three attempts");
  expect(inference.seen).toHaveLength(3); expect(agent.record).toBeUndefined();
  expect(agent.events.filter(e => e.stage === "tool")).toHaveLength(3);
});

test("a microphone booking finishes on one acceptance and exports the mock test payload", async () => {
  const inference = new FakeInference([directory(), availability(), say("¿Le viene bien esta cita?"), call("complete_call", booking)]);
  const { clinic, requests } = clinicFixture();
  let confirmations = 0;
  const report = await runRehearsal(inference, clinic, bookCase, signal(), () => {}, async () => {
    confirmations++; return "Sí, esa opción me parece perfecta.";
  });
  expect(confirmations).toBe(1); expect(report.error).toBeUndefined();
  expect(report.record).toEqual(booking); expect(report.evaluation.status).toBe("pass");
  expect(report.platform_submission).toBe(false);
  expect(report.submission_preview).toEqual([{ method: "POST", path: "/api/v1/submit/book", body: {
    patient_id: action.patient_id, provider_id: action.provider_id, location_id: action.location_id,
    appointment_type_id: action.appointment_type_id, slot: action.slot, policy_id: action.policy_id, call_id: "<start.callSid>",
  } }]);
  expect(requests).toHaveLength(2);
  expect(inference.audioCalls.filter(c => c.operation === "speak")).toHaveLength(2);
  expect(inference.seen).toHaveLength(4);
});
test("free chat saves the mock resolution without requesting another caller reply", async () => {
  const record = { actions: [{ action: "NO_ACTION", reason: "out_of_scope" }] };
  let inputs = 0;
  const report = await runFreeConversation(new FakeInference([say("Hola"), call("complete_call", record)]), noClinic, "es", signal(), () => {}, async () => {
    inputs++; return "No necesito cita, gracias.";
  });
  expect(inputs).toBe(1); expect(report.status).toBe("completed"); expect(report.record).toEqual(record);
  expect(report.platform_submission).toBe(false);
  expect(report.submission_preview).toEqual([{ method: "POST", path: "/api/v1/submit/no-action", body: { reason: "out_of_scope", call_id: "<start.callSid>" } }]);
  expect(report.transcript.at(-1)?.text).toBe(completionSpeech("es"));
});
