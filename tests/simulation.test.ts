import { expect, test } from "bun:test";
import { CallerWire, callerResponse, localTarget, requireDryRun, runSimulatedCall, type CallResult } from "../src/simulation/call";
import { gradeCall } from "../src/simulation/runner";
import { WireInspector } from "../src/protocol";
import { LocalRuntime, type Inference } from "../src/voice/runtime";
import type { PlatformCallReport } from "../src/telephony/call";
import type { ObjectValue } from "../src/data";

import { now, scenario } from "./helpers/simulation";

test("preflight refuses live mode, unready and non-local endpoints", () => {
  expect(() => requireDryRun({ ready: true, mode: "platform" })).toThrow("--dry-run");
  expect(() => requireDryRun({ ready: false, mode: "dry_run" })).toThrow("not ready");
  expect(() => requireDryRun({ ready: true, mode: "dry_run" })).not.toThrow();
  expect(localTarget("ws://127.0.0.1:7860/ws").health).toBe("http://127.0.0.1:7860/healthz");
  for (const url of ["wss://external.test/ws", "ws://127.0.0.1:7860/ws?token=x", "ws://user:pass@localhost/ws", "ws://localhost/other"])
    expect(() => localTarget(url)).toThrow("local");
});
test("wire preserves telephony frames, silence, padding and sequence after a mark ack", () => {
  const sent: ObjectValue[] = [], inspect = new WireInspector();
  const wire = new CallerWire("workbench-test", "MS-test", raw => { const message = JSON.parse(raw); sent.push(message); inspect.receive(message); });
  wire.start("+34600000000"); wire.tick(); wire.play(Buffer.alloc(161, 0x81)); wire.tick();
  const incoming = { event: "media", streamSid: "MS-test", media: { payload: Buffer.alloc(160, 0x82).toString("base64") } };
  wire.receive(incoming); wire.receive({ event: "clear", streamSid: "MS-test" });
  expect(wire.receive({ event: "mark", streamSid: "MS-test", mark: { name: "done" } })).toEqual(Buffer.alloc(160, 0x82));
  wire.tick(); wire.tick(); wire.stop();
  expect(inspect.finish().errors).toEqual([]);
  const media = sent.filter(x => x.event === "media").map(x => x.media as ObjectValue);
  expect(media.map(x => x.timestamp)).toEqual(["0", "20", "40", "60"]);
  expect(Buffer.from(media[2]!.payload as string, "base64")).toEqual(Buffer.concat([Buffer.from([0x81]), Buffer.alloc(159, 0xff)]));
  expect(Buffer.from(media[3]!.payload as string, "base64")).toEqual(Buffer.alloc(160, 0xff));
  expect(() => wire.receive({ ...incoming, streamSid: "other" })).toThrow("cross-call");
  expect(() => wire.play(Buffer.alloc(160001))).toThrow("20 seconds");
});
test("caller response validates wait and bounds speech before synthesis", () => {
  expect(callerResponse('{"speech":"","wait":true}')).toEqual({ speech: "", wait: true });
  for (const value of [{ speech: "", wait: false }, { speech: "Hello", wait: true }, { speech: "a".repeat(451), wait: false }])
    expect(() => callerResponse(JSON.stringify(value))).toThrow("invalid");
});
test("runtime model override creates an independent caller without changing the receptionist configuration", () => {
  const runtime = new LocalRuntime(() => {}, { model: { provider: "openrouter", model: "openai/gpt-4.1-mini", maxTokens: 512 } });
  expect(runtime.modelLabel).toBe("OpenRouter openai/gpt-4.1-mini"); expect(runtime.state).toBe("idle"); runtime.stop();
});
test("grading never passes failed or incomplete calls with a matching record", async () => {
  const item = await scenario();
  const call: CallResult = { call_id: "workbench-test", elapsed_ms: 1000, close_code: 1000, events: [], errors: [] };
  const report: PlatformCallReport = { call_id: call.call_id, session_id: "session", mode: "dry_run", reference_time: now,
    elapsed_ms: 1000, status: "completed", record: item.case.expected.acceptable[0], transcript: [], events: [], errors: [],
    submissions: [{ action_index: 0, path: "/api/v1/submit/book", accepted: false, dry_run: true }] };
  expect(gradeCall(item, call, report).status).toBe("pass");
  expect(gradeCall(item, { ...call, errors: ["Caller ASR failed"] }, report).status).toBe("fail");
  expect(gradeCall(item, { ...call, close_code: 1006 }, report).status).toBe("fail");
  expect(gradeCall(item, call, { ...report, status: "ended" }).status).toBe("fail");
  expect(gradeCall(item, call).status).toBe("fail");
  expect(gradeCall(item, call, { ...report, call_id: "other" }).status).toBe("fail");
  expect(gradeCall(item, call, { ...report, record: { actions: [{ action: "CANCEL", appointment_id: "A-live" }] } }).status).toBe("fail");
});

test("caller listens to socket audio and finishes final transcription after a normal server close", async () => {
  const generated = await scenario();
  const sent: ObjectValue[] = [], operations: string[] = [];
  let stream = "", spokenFrames = 0, closed = false;
  const fake = {
    readyState: WebSocket.CONNECTING as number,
    onopen: null as null | (() => void), onmessage: null as null | ((event: { data: string }) => void),
    onclose: null as null | ((event: { code: number }) => void), onerror: null,
    send(raw: string) {
      const value = JSON.parse(raw); sent.push(value);
      if (value.event === "start") { stream = value.streamSid; queueMicrotask(() => reply()); }
      if (value.event === "media" && Buffer.from(value.media.payload, "base64")[0] === 0x81 && ++spokenFrames === 2) {
        queueMicrotask(() => { reply(); fake.close(); });
      }
    },
    close() { if (closed) return; closed = true; fake.readyState = WebSocket.CLOSED; fake.onclose?.({ code: 1000 }); },
  };
  function reply() {
    fake.onmessage?.({ data: JSON.stringify({ event: "media", streamSid: stream, media: { payload: Buffer.alloc(160, 0x82).toString("base64") } }) });
    fake.onmessage?.({ data: JSON.stringify({ event: "mark", streamSid: stream, mark: { name: "reply" } }) });
  }
  const inference: Inference = {
    async audio(op) { operations.push(op); return op === "speak" ? { payload: Buffer.alloc(320, 0x81).toString("base64"), elapsed_ms: 1 }
      : { text: closed ? "Your appointment is booked." : "How can I help?", elapsed_ms: 1 }; },
    async chat(messages) { expect(JSON.stringify(messages)).not.toContain("P-live"); return { message: { role: "assistant", content: '{"speech":"Hello, I want an appointment.","wait":false}' }, elapsed_ms: 1 }; },
    async removeAudio() {},
  };
  const result = await runSimulatedCall({ endpoint: "ws://127.0.0.1:7860/ws", token: "synthetic-test-token", callId: "workbench-test",
    item: generated.case, inference, signal: AbortSignal.timeout(2000), update() {}, saveAudio: async role => [`${role}.wav`],
    connect(_url, options) { expect(options.headers).toEqual({ Authorization: "Bearer synthetic-test-token" });
      queueMicrotask(() => { fake.readyState = WebSocket.OPEN; fake.onopen?.(); }); return fake as unknown as WebSocket; },
  });
  expect(result.errors).toEqual([]); expect(result.close_code).toBe(1000);
  expect(result.events.map(e => e.role)).toEqual(["heard_agent", "caller", "heard_agent"]);
  expect(operations).toEqual(["transcribe_mulaw", "speak", "transcribe_mulaw"]);
  expect(sent.filter(m => m.event === "mark")).toHaveLength(2);
});
