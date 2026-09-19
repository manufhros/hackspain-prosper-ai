import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { edgeAllowed, edgeAsset, edgeEvent } from "../src/edge/http";
import { serverConfig, serverHandlers, type SocketData } from "../src/telephony/server";
import { SharedAudio } from "../src/telephony/audio";
import type { Inference } from "../src/voice/runtime";
import { wireMessages } from "../src/protocol";

const request = (path = "/edge/ws", origin = "http://localhost", host = "localhost") => new Request(`http://${host}${path}`, { headers: { origin } });
function fixture(edge = true) {
  let saved = 0, logged = 0, requests = 0;
  const lifetime = new AbortController();
  const inference: Inference = {
    async chat() { return { elapsed_ms: 1, message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "complete_call", arguments: { actions: [{ action: "NO_ACTION", reason: "out_of_scope" }] } } },
    ] } }; },
    async audio(op) { return op === "speak" ? { payload: Buffer.alloc(160, 160).toString("base64"), elapsed_ms: 1 } : { text: "No necesito cita", language: "es", elapsed_ms: 1 }; },
    async removeAudio() {},
  };
  const handlers = serverHandlers(serverConfig({ VOICE_MAX_CALLS: "1", VOICE_SERVER_TOKEN: "test-server-token-with-entropy" }, edge ? ["--edge"] : []), {
    inference, lifetime: lifetime.signal, audio: new SharedAudio(inference, lifetime.signal),
    clinic: { async request() { requests++; throw new Error("Unexpected clinic request"); } },
    async report() { saved++; }, onEvent() { logged++; }, sleep: async () => {},
  }, () => true);
  let upgraded: SocketData | undefined;
  const server = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4" as const, port: 1 }), upgrade(_request: Request, options?: { data?: SocketData }) { upgraded = options?.data; return true; } };
  return { handlers, server, lifetime, counts: () => ({ saved, logged, requests }), data: () => upgraded! };
}

test("edge is opt-in and every bundled asset is served locally with restrictive headers", async () => {
  expect(serverConfig({}, []).edge).toBe(false);
  expect(serverConfig({}, ["--edge"]).edge).toBe(true);
  const f = fixture(false);
  for (const path of ["/", "/edge/", "/edge/app.js", "/edge/ws"]) expect(f.handlers.fetch(request(path), f.server)?.status).toBe(404);
  for (const path of ["/edge/", "/edge/style.css", "/edge/app.js", "/edge/audio.js", "/edge/capture.js", "/edge/locale.js"]) {
    const response = edgeAsset(request(path), "127.0.0.1")!;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await response.text()).length).toBeGreaterThan(100);
  }
  expect(edgeAsset(request("/edge/.env"), "127.0.0.1")).toBeUndefined();
});

test("edge rejects remote peers, tunnel hosts, cross-origin requests and unknown options without bypassing /ws auth", () => {
  const f = fixture();
  for (const [origin, host, address] of [
    ["http://localhost", "localhost", "10.0.0.4"],
    ["https://tunnel.example", "tunnel.example", "127.0.0.1"],
    ["https://other.example", "localhost", "127.0.0.1"],
    ["null", "localhost", "127.0.0.1"],
    ["http://localhost", "localhost", ""],
  ]) expect(edgeAllowed(request("/edge/ws", origin, host), address)).toBe(false);
  expect(edgeAllowed(request(), "::1")).toBe(true);
  expect(f.handlers.fetch(request("/ws"), f.server)?.status).toBe(401);
  expect(f.handlers.fetch(request("/edge/ws", "https://other.example"), f.server)?.status).toBe(403);
  expect(f.handlers.fetch(request("/edge/ws?language=fr"), f.server)?.status).toBe(400);
  expect(f.handlers.fetch(request("/edge/ws?token=secret"), f.server)?.status).toBe(400);
  expect(f.handlers.fetch(request("/edge/ws?language=ca"), f.server)).toBeUndefined();
  expect(f.data()).toEqual({ edge: true, language: "ca" });
  expect(f.handlers.fetch(request(), f.server)?.status).toBe(503);
});

test("edge forwarding includes only conversation text and excludes internal traces", () => {
  for (const stage of ["tool", "llm", "reasoning", "error", "audio_summary"])
    expect(edgeEvent({ stage, elapsed_ms: 0, detail: "patient data", metrics: { private: "value" } })).toBeUndefined();
  expect(edgeEvent({ stage: "asr_start", elapsed_ms: 0, detail: "private" })).toEqual({ event: "edge_state", state: "thinking" });
  for (const stage of ["caller", "agent", "service"]) {
    expect(edgeEvent({ stage, elapsed_ms: 0, detail: "Hola", metrics: { private: "value" } }))
      .toEqual({ event: "edge_message", role: stage === "caller" ? "user" : "agent", text: "Hola" });
    expect(edgeEvent({ stage, elapsed_ms: 0, detail: "  " })).toBeUndefined();
  }
  expect(edgeEvent({ stage: "output_incomplete", elapsed_ms: 0, detail: "Internal error" }))
    .toEqual({ event: "edge_message_status", status: "audio_incomplete" });
});

test("an edge conversation shares inference but never submits, saves or logs patient sessions, even when /ws is live", async () => {
  const f = fixture();
  f.handlers.fetch(request(), f.server);
  const sent: Record<string, unknown>[] = [];
  const socket = { data: f.data(), getBufferedAmount: () => 0, send(raw: string) { sent.push(JSON.parse(raw)); return raw.length; }, close() {} } as unknown as ServerWebSocket<SocketData>;
  f.handlers.websocket.open(socket);
  const wire = wireMessages("workbench-edge-test", "edge-test");
  f.handlers.websocket.message(socket, JSON.stringify(wire.connected));
  f.handlers.websocket.message(socket, JSON.stringify(wire.start));
  for (let i = 0; i < 8; i++) await Bun.sleep(0);
  for (let i = 0; i < 46; i++) {
    const frame = wire.media(i); frame.media.payload = Buffer.alloc(160, i < 6 ? 160 : 255).toString("base64");
    f.handlers.websocket.message(socket, JSON.stringify(frame));
  }
  await socket.data.call!.done;
  expect(sent.some(message => message.event === "media")).toBe(true);
  const conversation = sent.filter(message => message.event === "edge_message");
  expect(conversation.map(message => message.role)).toEqual(["agent", "user", "agent"]);
  expect(conversation[0]!.text).toBe("Clínica Arenal, ¿en qué puedo ayudarle?");
  expect(conversation[1]!.text).toBe("No necesito cita");
  expect(sent.findIndex(message => message.event === "media")).toBeLessThan(sent.indexOf(conversation[0]!));
  expect(sent).toContainEqual({ event: "edge_end", reason: "completed" });
  expect(f.counts()).toEqual({ requests: 0, saved: 0, logged: 0 });
  expect(f.handlers.calls.size).toBe(0);
  expect(f.handlers.fetch(request(), f.server)).toBeUndefined();
});

test("disconnect cancels edge inference and releases its capacity without persistence", async () => {
  const f = fixture(); f.handlers.fetch(request(), f.server);
  const socket = { data: f.data(), getBufferedAmount: () => 0, send: () => 1, close() {} } as unknown as ServerWebSocket<SocketData>;
  f.handlers.websocket.open(socket); f.handlers.websocket.close(socket, 1000);
  await socket.data.call!.done;
  expect(socket.data.lifetime!.signal.aborted).toBe(true);
  expect(f.counts()).toEqual({ requests: 0, saved: 0, logged: 0 });
  expect(f.handlers.fetch(request(), f.server)).toBeUndefined();
});
