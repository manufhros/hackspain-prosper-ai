import { expect, test } from "bun:test";
import { callCount, callPlans, runCallBatch, sharedCallerInference } from "../src/simulation/batch";
import { simulate } from "../src/simulation/runner";
import { runSimulatedCall } from "../src/simulation/call";
import type { Inference } from "../src/voice/runtime";
import { scenario } from "./helpers/simulation";

test("call count defaults to one and rejects invalid input before any service access", async () => {
  expect(callCount()).toBe(1);
  expect(callCount("50")).toBe(50);
  for (const value of ["", "0", "-1", "1.5", "abc", "Infinity", "51", "1e1"])
    await expect(simulate([`--calls=${value}`])).rejects.toThrow("--calls must be an integer from 1 to 50");
});

test("batch scenarios have reproducible distinct seeds and independent call/artifact IDs", () => {
  expect(callPlans("example", 1)[0]!.seed).toBe("example");
  const first = callPlans("example", 3), second = callPlans("example", 3);
  expect(first.map(plan => plan.seed)).toEqual(["example:1", "example:2", "example:3"]);
  expect(first.map(plan => plan.seed)).toEqual(second.map(plan => plan.seed));
  expect(new Set([...first, ...second].map(plan => plan.id)).size).toBe(6);
  expect(first.every(plan => plan.callId === `workbench-${plan.id}`)).toBe(true);
});

test("batch starts all calls together and waits for peers after an individual failure", async () => {
  const gate = Promise.withResolvers<void>(), started: string[] = [];
  let finished = false;
  const work = runCallBatch([{ callId: "one" }, { callId: "two" }, { callId: "three" }], async ({ callId }) => {
    started.push(callId);
    if (callId === "two") throw new Error("Connection refused");
    await gate.promise;
    return { call_id: callId, status: "connected_and_closed", report_path: `${callId}.json` };
  }).then(result => { finished = true; return result; });
  expect(started).toEqual(["one", "two", "three"]);
  await Promise.resolve();
  expect(finished).toBe(false);
  gate.resolve();
  const batch = await work;
  expect(batch).toMatchObject({ calls: 3, succeeded: 2, failed: 1 });
  expect(batch.results[1]).toEqual({ call_id: "two", status: "fail", errors: ["Connection refused"] });
  expect(batch.results[2]!.report_path).toBe("three.json");
});

test("cancelling one caller's speech leaves shared native work and other callers alive", async () => {
  const lifetime = new AbortController(), caller = new AbortController();
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const nativeSignals: AbortSignal[] = [];
  const runtime: Inference = {
    async audio(_operation, _fields, signal) {
      nativeSignals.push(signal); started.resolve(); await release.promise;
      return { payload: "speech", elapsed_ms: 1 };
    },
    async chat() { throw new Error("Unexpected chat"); }, async removeAudio() {},
  };
  const inference = sharedCallerInference(runtime, lifetime.signal, 1);
  const first = inference.audio("speak", { text: "first" }, caller.signal);
  await started.promise;
  const second = inference.audio("speak", { text: "second" }, new AbortController().signal);
  caller.abort(new Error("call stopped"));
  await expect(first).rejects.toThrow("call stopped");
  expect(nativeSignals[0]).toBe(lifetime.signal);
  expect(nativeSignals[0]!.aborted).toBe(false);
  release.resolve();
  expect((await second).payload).toBe("speech");
  expect(nativeSignals).toHaveLength(2);
});

test("concurrent wire calls keep stream IDs, transcripts and recordings isolated", async () => {
  const generated = await scenario(), plans = callPlans("wire", 3);
  const opened = Promise.withResolvers<void>(), transcribed = Promise.withResolvers<void>();
  const sockets: { close(): void }[] = [], streams: string[] = [];
  const events = new Map<string, string[]>(), recordings = new Map<string, string[]>();
  let heard = 0;
  const work = runCallBatch(plans, async plan => {
    const saved: string[] = [], text: string[] = [];
    recordings.set(plan.callId, saved); events.set(plan.callId, text);
    const inference: Inference = {
      async audio() { if (++heard === plans.length) transcribed.resolve(); return { text: plan.callId, elapsed_ms: 1 }; },
      async chat() { return { message: { role: "assistant", content: '{"speech":"","wait":true}' }, elapsed_ms: 1 }; },
      async removeAudio() {},
    };
    const call = await runSimulatedCall({ endpoint: "wss://team.example/audio", callId: plan.callId,
      item: generated.case, inference, signal: AbortSignal.timeout(2000),
      update: event => { text.push(event.text); }, saveAudio: async role => { saved.push(`${plan.id}/${role}.wav`); return saved; },
      connect() {
        const fake = {
          readyState: WebSocket.CONNECTING as number,
          onopen: null as null | (() => void), onmessage: null as null | ((event: { data: string }) => void),
          onclose: null as null | ((event: { code: number }) => void), onerror: null,
          send(raw: string) {
            const message = JSON.parse(raw);
            if (message.event !== "start") return;
            expect(message.start.callSid).toBe(plan.callId);
            streams.push(message.streamSid);
            fake.onmessage?.({ data: JSON.stringify({ event: "media", streamSid: message.streamSid, media: { payload: Buffer.alloc(160, 0x82).toString("base64") } }) });
            fake.onmessage?.({ data: JSON.stringify({ event: "mark", streamSid: message.streamSid, mark: { name: "greeting" } }) });
            if (streams.length === plans.length) opened.resolve();
          },
          close() { if (fake.readyState === WebSocket.CLOSED) return; fake.readyState = WebSocket.CLOSED; fake.onclose?.({ code: 1000 }); },
        };
        sockets.push(fake);
        queueMicrotask(() => { fake.readyState = WebSocket.OPEN; fake.onopen?.(); });
        return fake as unknown as WebSocket;
      },
    });
    expect(call.errors).toEqual([]);
    expect(call.close_code).toBe(1000);
    return { call_id: plan.callId, status: "connected_and_closed" };
  });
  await Promise.all([opened.promise, transcribed.promise]);
  expect(new Set(streams).size).toBe(3);
  sockets.forEach(socket => socket.close());
  expect((await work).succeeded).toBe(3);
  for (const plan of plans) {
    expect(events.get(plan.callId)).toEqual([plan.callId]);
    expect(recordings.get(plan.callId)).toEqual([`${plan.id}/agent.wav`]);
  }
});
