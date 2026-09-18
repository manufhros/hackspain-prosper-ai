import { expect, test } from "bun:test";
import { wireMessages } from "../src/protocol";
import { defaultVad, SharedAudio } from "../src/telephony/audio";
import { PlatformCall, type CallOptions, type PlatformCallReport } from "../src/telephony/call";
import { ResolutionSubmitter } from "../src/telephony/submission";
import { LiveTranscript } from "../src/telephony/transcript";
import { type ClinicReader } from "../src/voice/agent";
import { type Inference, type Message } from "../src/voice/runtime";
import { type ObjectValue, type Outcome } from "../src/data";

const say = (content: string): Message => ({ role: "assistant", content });
const complete = (reason = "out_of_scope"): Message => ({ role: "assistant", content: "", tool_calls: [
  { function: { name: "complete_call", arguments: { actions: [{ action: "NO_ACTION", reason }] } } },
] });
const record: Outcome = { actions: [{ action: "NO_ACTION", reason: "out_of_scope" }, { action: "ESCALATE", reason: "medical_emergency" }] };
const speech = Buffer.alloc(160, 160), silence = Buffer.alloc(160, 255);
const tick = async () => { for (let i = 0; i < 8; i++) await Bun.sleep(0); };

function fixture(replies: Message[] = [say("Hola"), complete()], live = true, status = 200, overrides: Partial<CallOptions> = {}) {
  replies = replies.slice(1); // Platform greetings are fixed and do not use the model.
  const lifetime = new AbortController();
  const reports: PlatformCallReport[] = [], sent: ObjectValue[] = [], sleeps: number[] = [];
  const requests: { path: string; method: string; body?: ObjectValue }[] = [];
  const seen: Message[][] = [];
  const audioCalls: string[] = [];
  const output: string[] = [];
  const transcript = new LiveTranscript(text => output.push(text));
  const inference: Inference = {
    async chat(messages, _tools, signal) { signal.throwIfAborted(); seen.push(structuredClone(messages)); const message = replies.shift(); if (!message) throw new Error("No fake response"); return { message, elapsed_ms: 1 }; },
    async audio(op, _fields, signal) { signal.throwIfAborted(); audioCalls.push(op); return op === "speak" ? { payload: speech.toString("base64"), elapsed_ms: 1 } : { text: "No necesito cita", language: "es", elapsed_ms: 1 }; },
    async removeAudio() {},
  };
  const clinic: ClinicReader = { async request(request) { requests.push(request); return { status, meaning: `HTTP ${status}`, elapsed_ms: 1, data: {} }; } };
  const claimed = new Set<string>();
  const options = { inference, audio: new SharedAudio(inference, lifetime.signal), clinic, lifetime: lifetime.signal,
    live, language: "es", vad: defaultVad,
    claim: (id: string) => { if (claimed.has(id)) return false; claimed.add(id); return true; },
    onEvent: transcript.event,
    report: async (report: PlatformCallReport) => { reports.push(report); transcript.finish(report, `/reports/${report.session_id}.json`); },
    socket: { send: (raw: string) => { sent.push(JSON.parse(raw)); return raw.length; }, close() {} },
    sleep: async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); sleeps.push(ms); },
  };
  const call = new PlatformCall({ ...options, ...overrides });
  const start = (id = "real-call-1", stream = "MZ-1") => {
    const wire = wireMessages(id, stream); call.receive(JSON.stringify(wire.connected)); call.receive(JSON.stringify(wire.start)); return wire;
  };
  const utterance = (wire: ReturnType<typeof wireMessages>, frames = 6, silenceFrames = 40) => {
    for (let index = 0; index < frames + silenceFrames; index++) {
      const media = wire.media(index); media.media.payload = (index < frames ? speech : silence).toString("base64"); call.receive(JSON.stringify(media));
    }
  };
  return { call, start, utterance, lifetime, reports, sent, sleeps, requests, seen, audioCalls, output, options, inference, clinic };
}

test("platform call greets, transcribes mu-law, submits its actual callSid and sends paced audio", async () => {
  const f = fixture(); const wire = f.start(); await tick();
  expect(f.reports).toHaveLength(0);
  expect(f.output).toContain("[Call 1] RECEPTIONIST: Clínica Arenal, ¿en qué puedo ayudarle?");
  expect(f.output[0]).toContain("CONVERSATION START · real-call-1");
  f.utterance(wire); await f.call.done;
  expect(f.output).toContain("[Call 1] CALLER: No necesito cita");
  expect(f.output.some(line => line.includes("[Call 1] ===== CONVERSATION END · completed · 1 actions accepted"))).toBe(true);
  expect(f.requests).toEqual([{ method: "POST", path: "/api/v1/submit/no-action", body: { reason: "out_of_scope", call_id: "real-call-1" } }]);
  expect(f.reports[0]!.status).toBe("completed"); expect(f.reports[0]!.mode).toBe("platform");
  expect(f.reports[0]!.submissions[0]!.accepted).toBe(true);
  const media = f.sent.filter(m => m.event === "media"); expect(media).toHaveLength(2);
  expect(media.every(m => m.streamSid === "MZ-1" && Buffer.from((m.media as ObjectValue).payload as string, "base64").length === 160)).toBe(true);
  expect(f.sleeps).toEqual([20, 20, 200]); expect(f.audioCalls).toEqual(["speak", "transcribe_mulaw", "speak"]);
  expect(f.seen.at(-1)!.some(m => m.role === "user" && m.content === "No necesito cita")).toBe(true);
});
test("stop flushes a final spoken response and allows submission after the socket closes", async () => {
  const f = fixture(); const wire = f.start("call-final-yes"); await tick();
  f.utterance(wire, 6, 0); f.call.receive(JSON.stringify(wire.stop(6))); await f.call.done;
  expect(f.requests[0]!.body!.call_id).toBe("call-final-yes");
  expect(f.reports[0]!.status).toBe("completed");
  expect(f.sent.filter(m => m.event === "media")).toHaveLength(1); // no audio on a closed socket
});
test("dry-run uses the same transport but never POSTs synthetic call IDs", async () => {
  const f = fixture(undefined, false); const wire = f.start("workbench-probe"); await tick(); f.utterance(wire); await f.call.done;
  expect(f.requests).toHaveLength(0); expect(f.reports[0]!.submissions[0]!.dry_run).toBe(true);
  const live = fixture(); live.start("workbench-probe"); await live.call.done;
  expect(live.requests).toHaveLength(0); expect(live.reports[0]!.errors.join()).toContain("Synthetic");
});
test("malformed frames and cross-call stream IDs close without clinic access", async () => {
  for (const wrong of ["stream", "audio", "sequence"]) {
    const f = fixture(); const wire = f.start(); await tick();
    const media = wire.media(0);
    if (wrong === "stream") media.streamSid = "MZ-other";
    if (wrong === "audio") media.media.payload = "not-base64";
    if (wrong === "sequence") media.sequenceNumber = "10";
    f.call.receive(JSON.stringify(media)); await f.call.done;
    expect(f.reports[0]!.status).toBe("error"); expect(f.requests).toHaveLength(0);
  }
});
test("twenty overlapping calls retain independent histories, IDs and submissions", async () => {
  const f = fixture(); f.call.end(); await f.call.done; f.reports.length = 0;
  f.inference.chat = async messages => ({ elapsed_ms: 1, message: messages.some(m => m.role === "user" && m.content === "No necesito cita") ? complete() : say("Hola") });
  const calls = Array.from({ length: 20 }, (_, i) => {
    const sent: ObjectValue[] = [];
    const call = new PlatformCall({ ...f.options, socket: { send(raw) { sent.push(JSON.parse(raw)); return raw.length; }, close() {} } });
    const wire = wireMessages(`real-${i}`, `MZ-${i}`);
    call.receive(JSON.stringify(wire.connected)); call.receive(JSON.stringify(wire.start));
    return { call, wire, sent, i };
  });
  await tick();
  for (let frame = 0; frame < 46; frame++) for (const { call, wire } of calls) {
    const media = wire.media(frame); media.media.payload = (frame < 6 ? speech : silence).toString("base64"); call.receive(JSON.stringify(media));
  }
  await Promise.all(calls.map(c => c.call.done));
  expect(f.requests).toHaveLength(20); expect(new Set(f.requests.map(r => r.body!.call_id)).size).toBe(20);
  expect(f.reports.every(r => r.status === "completed")).toBe(true);
  for (const { sent, i } of calls) expect(sent.every(message => message.streamSid === `MZ-${i}`)).toBe(true);
  for (let i = 0; i < 20; i++) {
    const label = `[Call ${i + 2}]`; // fixture's initial, ended socket was Call 1
    expect(f.output).toContain(`\n${label} ===== CONVERSATION START · real-${i} =====`);
    expect(f.output).toContain(`${label} CALLER: No necesito cita`);
    expect(f.output).toContain(`${label} RECEPTIONIST: Clínica Arenal, ¿en qué puedo ayudarle?`);
    expect(f.output.filter(line => line.startsWith(`${label} ===== CONVERSATION END`))).toHaveLength(1);
  }
});

test("live transcript keeps control characters and multiline text inside the conversation label", () => {
  const output: string[] = [], transcript = new LiveTranscript(text => output.push(text));
  const call = { session_id: "test-session", call_id: "test-call" };
  transcript.event(call, { stage: "caller", elapsed_ms: 0, detail: "Hola\n[Call 2] forged\r\u001b[2J\u0007adiós" });
  transcript.event(call, { stage: "interruption", elapsed_ms: 0, detail: "Playback stopped" });
  transcript.event(call, { stage: "tool", elapsed_ms: 0, detail: "Internal tool detail" });
  expect(output).toEqual([
    "\n[Call 1] ===== CONVERSATION START · test-call =====",
    "[Call 1] CALLER: Hola [Call 2] forged adiós",
    "[Call 1] INTERRUPTED: Playback stopped",
  ]);
});
test("one socket rejects a reused callSid while the original socket stays usable", async () => {
  const f = fixture(); f.start("shared-id"); await tick();
  const other = new PlatformCall(f.options), wire = wireMessages("shared-id", "MZ-2");
  other.receive(JSON.stringify(wire.connected)); other.receive(JSON.stringify(wire.start)); await other.done;
  expect(f.reports[0]!.errors.join()).toContain("already used");
  f.call.end(); await f.call.done; expect(f.reports).toHaveLength(2);
});
test("failed submissions are reported, not retried or presented as success", async () => {
  const f = fixture(undefined, true, 410); const wire = f.start(); await tick(); f.utterance(wire); await f.call.done;
  expect(f.requests).toHaveLength(1); expect(f.reports[0]!.status).toBe("error");
  expect(f.reports[0]!.submissions[0]!.status).toBe(410);
});
test("submission attempts are idempotent, preserve multiple intents, and honor the close deadline", async () => {
  const sent: ObjectValue[] = [];
  const clinic: ClinicReader = { async request(r) { sent.push(r.body!); return { status: sent.length === 1 ? 200 : 409, elapsed_ms: 1, meaning: "OK", data: {} }; } };
  let now = 1000;
  const submit = new ResolutionSubmitter(clinic, "carrier-call", true, new AbortController().signal, () => now);
  submit.closed(); now += 29_000;
  const [first, second] = await Promise.all([submit.submit(record), submit.submit(record)]);
  expect(first).toEqual(second); expect(sent).toHaveLength(2); expect(first.every(r => r.accepted)).toBe(true); expect(first[1]!.duplicate).toBe(true);
  submit.dispose();
  const expired = new ResolutionSubmitter(clinic, "late-call", true, new AbortController().signal, () => now);
  expired.closed(); now += 31_000;
  expect((await expired.submit(record)).every(r => !r.accepted && r.error?.includes("window closed"))).toBe(true);
  expect(sent).toHaveLength(2); expired.dispose();
});

test("caller speech interrupts paced playback without relying on clear acknowledgements", async () => {
  const f = fixture(); f.call.end(); await f.call.done; f.reports.length = 0;
  let waits = 0;
  const call = new PlatformCall({ ...f.options, sleep: async (_ms, signal) => {
    if (++waits === 1) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Interrupted")), { once: true }));
    else signal.throwIfAborted();
  } });
  const wire = wireMessages("interruption", "MZ-interruption");
  call.receive(JSON.stringify(wire.connected)); call.receive(JSON.stringify(wire.start)); await tick();
  for (let i = 0; i < 46; i++) {
    const media = wire.media(i); media.media.payload = (i < 6 ? speech : silence).toString("base64"); call.receive(JSON.stringify(media));
  }
  await call.done;
  expect(f.sent.some(m => m.event === "clear")).toBe(true);
  expect(f.reports[0]!.events.some(e => e.stage === "interruption")).toBe(true);
  expect(f.reports[0]!.status).toBe("completed");
});
test("a correction while completion is being inferred supersedes the unsubmitted resolution", async () => {
  const f = fixture();
  let resolveCompletion!: (value: { message: Message; elapsed_ms: number }) => void;
  let turns = 0;
  f.inference.chat = async () => {
    if (++turns === 1) return new Promise(resolve => resolveCompletion = resolve);
    return { message: complete("provider_not_found"), elapsed_ms: 1 };
  };
  const wire = f.start("corrected-call"); await tick(); f.utterance(wire); await tick();
  for (let i = 46; i < 92; i++) {
    const media = wire.media(i); media.media.payload = (i < 52 ? speech : silence).toString("base64"); f.call.receive(JSON.stringify(media));
  }
  resolveCompletion({ message: complete("out_of_scope"), elapsed_ms: 1 }); await f.call.done;
  expect(f.requests).toHaveLength(1); expect(f.requests[0]!.body!.reason).toBe("provider_not_found");
  expect(f.reports[0]!.record!.actions[0]!.reason).toBe("provider_not_found");
});

test("short outbound audio frames are padded with mu-law silence, never WAV headers", async () => {
  const f = fixture(); const audio = f.inference.audio;
  f.inference.audio = async (op, fields, signal) => op === "speak" ? { payload: Buffer.alloc(73, 160).toString("base64"), elapsed_ms: 1 } : audio(op, fields, signal);
  f.start(); await tick(); f.call.end(); await f.call.done;
  const frame = Buffer.from((f.sent.find(m => m.event === "media")!.media as ObjectValue).payload as string, "base64");
  expect(frame.length).toBe(160); expect(frame.subarray(0, 73).every(b => b === 160)).toBe(true); expect(frame.subarray(73).every(b => b === 255)).toBe(true);
});
test("shutdown aborts waiting calls and still produces a report", async () => {
  const f = fixture(); f.start(); await tick(); f.lifetime.abort(new Error("Server shutting down")); await f.call.done;
  expect(f.reports[0]!.errors).toContain("Server shutting down"); expect(f.requests).toHaveLength(0);
});


test("speech is logged only after synthesis sends audio; marks and close reasons are recorded", async () => {
  const f = fixture();
  let synthesized!: (reply: { payload: string; elapsed_ms: number }) => void;
  f.inference.audio = async () => new Promise(resolve => synthesized = resolve);
  f.start(); await tick();
  expect(f.seen).toHaveLength(0); // greeting has no model dependency
  expect(f.output.some(line => line.includes("RECEPTIONIST:"))).toBe(false);
  synthesized({ payload: speech.toString("base64"), elapsed_ms: 7 }); await tick();
  expect(f.output.some(line => line.includes("RECEPTIONIST:"))).toBe(true);
  const mark = f.sent.find(m => m.event === "mark")!;
  f.call.receive(JSON.stringify({ ...mark, sequenceNumber: "2" }));
  f.call.end("socket_closed", 1006); await f.call.done;
  const report = f.reports[0]!;
  expect(report.end_reason).toBe("socket_closed"); expect(report.close_code).toBe(1006);
  expect(report.audio_stats).toMatchObject({ inbound_frames: 0, outbound_frames: 1, playback_acks: 1 });
  expect(report.events.every(event => typeof event.at_ms === "number")).toBe(true);
  expect(report.events.find(e => e.stage === "tts")?.metrics).toMatchObject({ queue_ms: 0, cache_hit: 0 });
  expect(report.events.some(e => e.stage === "playback_ack")).toBe(true);
});

test("empty transcriptions prompt repetition and retain audio diagnostics", async () => {
  const f = fixture(); const audio = f.inference.audio;
  f.inference.audio = async (op, fields, signal) => op === "transcribe_mulaw" ? { text: "", elapsed_ms: 2 } : audio(op, fields, signal);
  const wire = f.start(); await tick(); f.utterance(wire); await tick();
  f.call.receive(JSON.stringify(wire.stop(46))); await f.call.done;
  const report = f.reports[0]!;
  expect(report.end_reason).toBe("peer_stop"); expect(report.errors).toEqual([]);
  expect(report.audio_stats).toMatchObject({ inbound_frames: 46, above_threshold_frames: 6, speech_starts: 1, utterances: 1, empty_transcriptions: 1 });
  expect(report.events.some(e => e.stage === "asr" && e.detail === "Empty transcription")).toBe(true);
  expect(f.output.some(line => line.includes("STATUS: No le he oído"))).toBe(true);
  expect(f.seen).toHaveLength(0); expect(f.requests).toHaveLength(0);
});

test("a silent call gets one bounded reminder and a distinct call-timeout reason", async () => {
  const f = fixture(undefined, true, 200, { idleNoticeMs: 5, callTimeoutMs: 50 });
  const wire = f.start();
  for (let i = 0; i < 10; i++) f.call.receive(JSON.stringify(wire.media(i)));
  await f.call.done;
  const report = f.reports[0]!;
  expect(report.end_reason).toBe("call_timeout");
  expect(report.events.filter(e => e.stage === "idle")).toHaveLength(1);
  expect(report.audio_stats).toMatchObject({ inbound_frames: 10, above_threshold_frames: 0, speech_starts: 0, empty_transcriptions: 0 });
  expect(f.seen).toHaveLength(0); expect(f.requests).toHaveLength(0);
});

test("slow model work gets one wait notice and a spoken timeout without submitting", async () => {
  const f = fixture(undefined, true, 200, { waitNoticeMs: 5, turnTimeoutMs: 40 });
  let aborted = false;
  f.inference.chat = async (_messages, _tools, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
  });
  const wire = f.start(); await tick(); f.utterance(wire); await f.call.done;
  const report = f.reports[0]!;
  expect(aborted).toBe(true); expect(report.status).toBe("error"); expect(report.end_reason).toBe("error");
  expect(report.events.filter(e => e.stage === "slow_turn")).toHaveLength(1);
  expect(report.events.some(e => e.stage === "timeout")).toBe(true);
  expect(f.output.some(line => line.includes("STATUS: Sigo comprobándolo"))).toBe(true);
  expect(f.output.some(line => line.includes("STATUS: Lo siento"))).toBe(true);
  expect(f.requests).toHaveLength(0);
});


test("reported clarification and natural confirmation produce exactly one platform booking", async () => {
  const booking = { actions: [{ action: "BOOK", patient_id: "P1", provider_id: "PR01", location_id: "sur",
    slot: "2026-09-21T09:00:00+02:00", appointment_type_id: "review", policy_id: "mapfre" }] };
  const tool = (name: string, args: ObjectValue): Message => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
  const f = fixture([say("unused"), tool("directory", { name: "Patient Example", date_of_birth: "1980-01-01" }),
    tool("availability", { patient_id: "P1", provider_id: "PR01", date_from: "2026-09-21", date_to: "2026-09-25" }), tool("offer_actions", booking),
    say("Yes, that Monday 09:00 is the earliest. Shall I hold that Monday slot?"), tool("complete_call", booking)], true, 200,
    { now: () => Date.parse("2026-09-18T09:00:00+02:00") });
  const replies = ["My name is Patient Example, born 1980-01-01. I need the earliest appointment.",
    "Is that the earliest?", "Ah, okay, yes, please book me for Monday at 9 with Dr. Martin."];
  const audio = f.inference.audio;
  f.inference.audio = async (op, fields, signal) => op === "transcribe_mulaw" ? { text: replies.shift()!, language: "en", elapsed_ms: 1 } : audio(op, fields, signal);
  f.clinic.request = async request => {
    f.requests.push(request);
    const data = request.path.includes("directory") ? { matches: [{ patient_id: "P1", given_name: "Patient", first_surname: "Example", date_of_birth: "1980-01-01" }] }
      : request.path.includes("availability") ? { slots: [{ ...booking.actions[0], start_time: booking.actions[0]!.slot,
        provider_name: "Dr. Martín Sáez", payable_with: ["mapfre"] }] } : {};
    return { status: 200, meaning: "OK", elapsed_ms: 1, data };
  };
  const wire = f.start("natural-confirmation"); await tick();
  for (let turn = 0; turn < 3; turn++) {
    for (let offset = 0; offset < 46; offset++) {
      const media = wire.media(turn * 46 + offset); media.media.payload = (offset < 6 ? speech : silence).toString("base64"); f.call.receive(JSON.stringify(media));
    }
    await tick();
    if (turn < 2) expect(f.requests.filter(r => r.method === "POST")).toHaveLength(0);
  }
  await f.call.done;
  expect(f.reports[0]!.errors).toEqual([]);
  expect(f.reports[0]!.status).toBe("completed");
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(1);
  expect(f.requests.at(-1)!.body).toMatchObject({ call_id: "natural-confirmation", slot: booking.actions[0]!.slot });
  expect(f.reports[0]!.events.filter(e => e.stage === "tool" && e.detail.startsWith("complete_call"))).toHaveLength(1);
});
