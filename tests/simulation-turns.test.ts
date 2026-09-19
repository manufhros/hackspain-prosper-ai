import { expect, test } from "bun:test";
import { runSimulatedCall, type CallerEvent } from "../src/simulation/call";
import type { Inference } from "../src/voice/runtime";
import type { SpeechDetector } from "../src/telephony/silero";
import { defaultVad, frameEnergy } from "../src/telephony/audio";
import { scenario } from "./helpers/simulation";

async function fixture(options: {
  start: (peer: ReturnType<typeof socketPeer>) => void;
  chat?: Inference["chat"];
  update?: (event: CallerEvent, peer: ReturnType<typeof socketPeer>) => void;
  greetingMs?: number;
  speechDetector?: SpeechDetector;
}) {
  const generated = await scenario(), peer = socketPeer(), progress: string[] = [], transcribed: Buffer[] = [];
  const inference: Inference = {
    async audio(op, fields) {
      if (op === "speak") return { payload: Buffer.alloc(160, 0x81).toString("base64"), elapsed_ms: 1 };
      transcribed.push(Buffer.from(fields.payload as string, "base64"));
      return { text: "Hello from the receptionist", elapsed_ms: 1 };
    },
    chat: options.chat ?? (async () => ({ message: { role: "assistant", content: '{"speech":"","wait":true}' }, elapsed_ms: 1 })),
    async removeAudio() {},
  };
  const work = runSimulatedCall({ endpoint: "wss://team.example/ws", callId: "turn-test", item: generated.case,
    inference, signal: AbortSignal.timeout(2000), timing: { greetingMs: options.greetingMs ?? 500, turnSilenceMs: 20 },
    speechDetector: options.speechDetector,
    progress: message => { progress.push(message); }, update: event => options.update?.(event, peer), saveAudio: async role => [`${role}.wav`],
    connect() {
      queueMicrotask(() => { peer.socket.readyState = WebSocket.OPEN; peer.socket.onopen?.(); options.start(peer); });
      return peer.socket as unknown as WebSocket;
    },
  });
  return { work, peer, progress, transcribed };
}

function socketPeer() {
  let stream = "";
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const sent: Record<string, any>[] = [];
  const socket = {
    readyState: WebSocket.CONNECTING as number,
    onopen: null as null | (() => void), onmessage: null as null | ((event: { data: string }) => void),
    onclose: null as null | ((event: { code: number }) => void), onerror: null,
    send(raw: string) { const data = JSON.parse(raw); sent.push(data); if (data.event === "start") stream = data.streamSid; },
    close() { clearInterval(keepAlive); if (socket.readyState === WebSocket.CLOSED) return; socket.readyState = WebSocket.CLOSED; socket.onclose?.({ code: 1000 }); },
  };
  return {
    socket, sent,
    audio(bytes = 160) { socket.onmessage?.({ data: JSON.stringify({ event: "media", streamSid: stream, media: { payload: Buffer.alloc(bytes, 0x82).toString("base64") } }) }); },
    silence(byte = 0xff) {
      const send = () => socket.onmessage?.({ data: JSON.stringify({ event: "media", streamSid: stream, media: { payload: Buffer.alloc(160, byte).toString("base64") } }) });
      send(); keepAlive = setInterval(send, 20);
    },
    mark() { socket.onmessage?.({ data: JSON.stringify({ event: "mark", streamSid: stream, mark: { name: "done" } }) }); },
  };
}

test("speech followed by continuous silence frames still triggers a spoken reply without marks", async () => {
  const f = await fixture({ start: peer => { peer.audio(1600); peer.silence(); },
    async chat() { return { message: { role: "assistant", content: '{"speech":"An appointment please","wait":false}' }, elapsed_ms: 1 }; },
    update: (event, peer) => { if (event.role === "caller") setTimeout(() => peer.socket.close(), 40); },
  });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["heard_agent", "caller"]);
  expect(f.transcribed).toHaveLength(1);
  expect(f.peer.sent.some(message => message.event === "media" && Buffer.from(message.media.payload, "base64")[0] === 0x81)).toBe(true);
});

test("continuous silence is not a greeting and does not stop the caller from speaking first", async () => {
  const f = await fixture({ start: peer => peer.silence(), greetingMs: 30,
    async chat() { return { message: { role: "assistant", content: '{"speech":"Hello","wait":false}' }, elapsed_ms: 1 }; },
    update: (event, peer) => { if (event.role === "caller") setTimeout(() => peer.socket.close(), 40); },
  });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["caller"]);
  expect(f.transcribed).toEqual([]);
});

test("neural speech decisions end a greeting despite continuous loud background audio", async () => {
  expect(frameEnergy(Buffer.alloc(160, 0x81))).toBeGreaterThan(defaultVad.threshold);
  let classified = 0, resets = 0;
  const f = await fixture({ start: peer => { peer.audio(1600); peer.silence(0x81); },
    speechDetector: { async push(frame) { classified++; return frame[0] === 0x82; }, reset() { resets++; } },
    async chat() { return { message: { role: "assistant", content: '{"speech":"An appointment please","wait":false}' }, elapsed_ms: 1 }; },
    update: (event, peer) => { if (event.role === "caller") setTimeout(() => peer.socket.close(), 40); },
  });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["heard_agent", "caller"]);
  expect(classified).toBeGreaterThan(10);
  expect(resets).toBe(1);
  expect(call.wire_stats?.speech_frames).toBe(10);
  expect(f.transcribed).toHaveLength(1);
});

test("background-only audio is never transcribed even when marked", async () => {
  const f = await fixture({ start: peer => { peer.silence(0x81); peer.mark(); }, greetingMs: 30,
    speechDetector: { async push() { return false; }, reset() {} },
    async chat() { return { message: { role: "assistant", content: '{"speech":"Hello","wait":false}' }, elapsed_ms: 1 }; },
    update: (event, peer) => { if (event.role === "caller") setTimeout(() => peer.socket.close(), 40); },
  });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["caller"]);
  expect(f.transcribed).toEqual([]);
  expect(call.wire_stats?.speech_frames).toBe(0);
});

test("audio without optional marks gets a spoken reply and a late mark does not duplicate the turn", async () => {
  const f = await fixture({ start: peer => peer.audio(),
    async chat() { return { message: { role: "assistant", content: '{"speech":"I want an appointment","wait":false}' }, elapsed_ms: 1 }; },
    update: (event, peer) => { if (event.role === "caller") { peer.mark(); setTimeout(() => peer.socket.close(), 40); } },
  });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["heard_agent", "caller"]);
  expect(f.peer.sent.some(message => message.event === "media" && Buffer.from(message.media.payload, "base64")[0] === 0x81)).toBe(true);
  expect(f.transcribed).toEqual([Buffer.alloc(160, 0x82)]);
  expect(call.wire_stats).toMatchObject({ received_audio_bytes: 160, received_marks: 1, turns_without_marks: 1 });
  expect(f.progress.some(message => message.includes("WebSocket connected"))).toBe(true);
  expect(f.progress.some(message => message.includes("without a mark"))).toBe(true);
});

test("marked replies cancel the idle fallback", async () => {
  const f = await fixture({ start: peer => { peer.audio(); peer.mark(); }, update: (_event, peer) => { peer.socket.close(); } });
  const call = await f.work;
  expect(call.events).toHaveLength(1);
  expect(call.wire_stats?.turns_without_marks).toBe(0);
  expect(f.progress.some(message => message.includes("without a mark"))).toBe(false);
});

test("unmarked audio is preserved when the endpoint closes immediately", async () => {
  const f = await fixture({ start: peer => { peer.audio(); peer.socket.close(); } });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["heard_agent"]);
  expect(f.transcribed).toHaveLength(1);
});

test("idle detection waits for burst audio duration and combines subsequent chunks", async () => {
  let earlyTranscription = false;
  const f = await fixture({
    start: peer => { peer.audio(1600); setTimeout(() => peer.audio(160), 40); },
    update: (_event, peer) => { peer.socket.close(); },
  });
  await Bun.sleep(100);
  earlyTranscription = f.transcribed.length > 0;
  expect(earlyTranscription).toBe(false);
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(f.transcribed).toEqual([Buffer.alloc(1760, 0x82)]);
});

test("caller speaks first if the endpoint waits for caller audio", async () => {
  const f = await fixture({ start() {}, greetingMs: 10,
    async chat(messages) {
      expect(messages.at(-1)?.content).toContain("Start the call now");
      return { message: { role: "assistant", content: '{"speech":"Hello, I want an appointment.","wait":false}' }, elapsed_ms: 1 };
    },
    update: (event, peer) => { if (event.role === "caller") setTimeout(() => peer.socket.close(), 40); },
  });
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["caller"]);
  expect(f.peer.sent.some(message => message.event === "media" && Buffer.from(message.media.payload, "base64")[0] === 0x81)).toBe(true);
  expect(f.progress.some(message => message.includes("caller will speak first"))).toBe(true);
});

test("a greeting arriving during opening generation suppresses the unsent opener", async () => {
  const generating = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ start() {}, greetingMs: 10,
    async chat() {
      generating.resolve(); await release.promise;
      return { message: { role: "assistant", content: '{"speech":"Hello","wait":false}' }, elapsed_ms: 1 };
    },
    update: (_event, peer) => peer.socket.close(),
  });
  await generating.promise;
  f.peer.audio(); f.peer.mark(); release.resolve();
  const call = await f.work;
  expect(call.errors).toEqual([]);
  expect(call.events.map(event => event.role)).toEqual(["heard_agent"]);
  expect(f.peer.sent.some(message => message.event === "media" && Buffer.from(message.media.payload, "base64")[0] === 0x81)).toBe(false);
});
