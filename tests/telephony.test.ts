import { expect, test } from "bun:test";
import { wireMessages } from "../src/protocol";
import { defaultVad, SharedAudio } from "../src/telephony/audio";
import { PlatformCall, type PlatformCallReport } from "../src/telephony/call";
import { ResolutionSubmitter } from "../src/telephony/submission";
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

function fixture(replies: Message[] = [say("Hola"), complete()], live = true, status = 200) {
  const lifetime = new AbortController();
  const reports: PlatformCallReport[] = [], sent: ObjectValue[] = [], sleeps: number[] = [];
  const requests: { path: string; method: string; body?: ObjectValue }[] = [];
  const seen: Message[][] = [];
  const audioCalls: string[] = [];
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
    report: async (report: PlatformCallReport) => { reports.push(report); },
    socket: { send: (raw: string) => { sent.push(JSON.parse(raw)); return raw.length; }, close() {} },
    sleep: async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); sleeps.push(ms); },
  };
  const call = new PlatformCall(options);
  const start = (id = "real-call-1", stream = "MZ-1") => {
    const wire = wireMessages(id, stream); call.receive(JSON.stringify(wire.connected)); call.receive(JSON.stringify(wire.start)); return wire;
  };
  const utterance = (wire: ReturnType<typeof wireMessages>, frames = 6, silenceFrames = 40) => {
    for (let index = 0; index < frames + silenceFrames; index++) {
      const media = wire.media(index); media.media.payload = (index < frames ? speech : silence).toString("base64"); call.receive(JSON.stringify(media));
    }
  };
  return { call, start, utterance, lifetime, reports, sent, sleeps, requests, seen, audioCalls, options, inference, clinic };
}

test("platform call greets, transcribes mu-law, submits its actual callSid and sends paced audio", async () => {
  const f = fixture(); const wire = f.start(); await tick();
  f.utterance(wire); await f.call.done;
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
    if (++turns === 1) return { message: say("Hola"), elapsed_ms: 1 };
    if (turns === 2) return new Promise(resolve => resolveCompletion = resolve);
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
