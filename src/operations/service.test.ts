import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OperationsService } from "./service.ts";
import { authorized, phoneToken, validPhoneToken } from "./security.ts";
import type { CallOptions } from "../agent/session.ts";
import type { CallSocket } from "../agent/socket.ts";
import { checkPhone, TwilioRequestError } from "./twilio.ts";

const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function fixture() {
  for (const key of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "PLATFORM_API_KEY"]) process.env[key] = "test";
  process.env.OPERATIONS_SECRET = "s".repeat(40);
  const options: CallOptions[] = [];
  const sockets: CallSocket[] = [];
  let dialed = 0, hungup = 0;
  let webhook = "";
  const deps = {
    options: { connect: async () => { throw new Error("No real connections"); } },
    origin: () => "https://voice.example",
    patients: async () => [0, 1, 2].map(i => ({ name: `Patient ${i}`, language: "es", goal: "test", data: {} })),
    core: async (socket: CallSocket, option: CallOptions) => {
      options.push(option); sockets.push(socket);
      socket.on("message", raw => { if (JSON.parse(String(raw)).event === "start") option.onMonitor?.({ type: "ready" }); });
    },
    checkPhone: async () => {},
    checkAgent: async () => {},
    verifyWebhook: async () => {},
    dial: async (url: string) => { dialed++; webhook = url; return { sid: "CA" + "a".repeat(32) }; },
    hangup: async () => { hungup++; return {}; },
    reply: async () => "[FIN]",
  };
  return { deps, options, sockets, get dialed() { return dialed; }, get hungup() { return hungup; }, get webhook() { return webhook; } };
}
test("three concurrent patients use Lucia core; phone is a fourth fresh session without join", async () => {
  const f = fixture(); const service = new OperationsService(f.deps);
  service.start();
  assert.throws(() => service.start(), /activa/);
  await settle();
  assert.equal(f.options.length, 3);
  assert.ok(f.options.every(option => option.textOnly && option.demo));
  assert.equal(f.dialed, 1);
  assert.equal(service.snapshot().calls.length, 4);
  const response = await service.fetch(new Request(f.webhook));
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.ok(xml.includes('demo-'));
  assert.ok(xml.includes('<Redirect method="POST">'));
  assert.ok(!xml.includes('<Connect>'));
  assert.ok(!xml.includes('name="join"'));
  assert.ok(!xml.includes("<Say"));
  class Socket extends EventEmitter { readyState = 1; send() {} close() { this.readyState = 3; this.emit("close"); } }
  await service.attachPhone(new Socket());
  assert.equal(f.options.length, 4);
  assert.equal(f.options[3]!.textOnly, undefined);
  assert.equal(f.options[3]!.demo, true);
  await service.stop();
  assert.equal(service.snapshot().state, "finished");
  assert.ok(f.hungup >= 1);
  assert.ok(!service.phoneAllowed(new URL(f.webhook)));
});
test("credential failure prevents all provider sessions and dialing", async () => {
  const f = fixture();
  const service = new OperationsService({ ...f.deps, checkPhone: async () => { throw new Error("Twilio respondió 401"); } });
  service.start(); await settle();
  assert.equal(service.snapshot().state, "error");
  assert.equal(f.dialed, 0); assert.equal(f.sockets.length, 0);
});
test("stopping while patient preflight is pending opens no sessions", async () => {
  const f = fixture();
  let resolve!: (value: Awaited<ReturnType<typeof f.deps.patients>>) => void;
  const service = new OperationsService({ ...f.deps, patients: () => new Promise(r => { resolve = r; }) });
  service.start(false);
  await settle();
  const stopping = service.stop();
  resolve(await f.deps.patients());
  await stopping;
  assert.equal(f.sockets.length, 0); assert.equal(f.dialed, 0);
  assert.equal(service.snapshot().state, "finished");
});
test("late Twilio creation after stop is terminated and never retried", async () => {
  const f = fixture(); let resolve!: (value: { sid: string }) => void;
  const service = new OperationsService({ ...f.deps, dial: () => new Promise(r => { resolve = r; }) });
  service.start(); await settle();
  const stopping = service.stop();
  resolve({ sid: "CA" + "b".repeat(32) });
  await stopping;
  assert.ok(f.hungup >= 1); assert.equal(service.snapshot().state, "finished");
});
test("uncertain origination blocks restart until explicit manual acknowledgement", async () => {
  const f = fixture();
  const service = new OperationsService({ ...f.deps, dial: async () => { throw new Error("timeout"); } });
  service.start(); await settle();
  assert.equal(service.snapshot().state, "uncertain");
  assert.throws(() => service.start(), /activa/);
  assert.ok(f.sockets.every(socket => socket.readyState === 1));
  assert.ok(service.snapshot().calls.filter(call => call.source === "llm").every(call => !call.ended));
  await assert.rejects(service.acknowledge(), /pacientes LLM/);
  await service.stop();
  assert.equal(service.snapshot().state, "uncertain");
  await service.acknowledge();
  assert.equal(service.snapshot().state, "finished");
});
test("controls require a server secret; phone tokens are scoped and expire", async () => {
  const f = fixture(); const service = new OperationsService(f.deps);
  assert.equal((await service.fetch(new Request("https://voice.example/operations/state"))).status, 403);
  assert.ok(authorized(new Request("https://voice.example", { headers: { authorization: "Bearer " + process.env.OPERATIONS_SECRET } })));
  assert.equal(authorized(new Request("https://voice.example", { headers: { authorization: "Bearer " + "é".repeat(process.env.OPERATIONS_SECRET!.length) } })), false);
  const expires = String(Date.now() + 60000);
  const url = new URL(`https://voice.example?expires=${expires}&token=${phoneToken("one", expires)}`);
  assert.ok(validPhoneToken(url, "one")); assert.ok(!validPhoneToken(url, "two"));
  url.searchParams.set("expires", String(Date.now() - 1)); assert.ok(!validPhoneToken(url, "one"));
});
test("account preflight allows Trial to attempt the actual REST transport", async t => {
  process.env.TWILIO_ACCOUNT_SID = "test"; process.env.TWILIO_AUTH_TOKEN = "test"; process.env.TWILIO_PHONE_NUMBER = "+12025550123";
  t.mock.method(globalThis, "fetch", async () => Response.json({ type: "Trial" }));
  await assert.doesNotReject(checkPhone());
});

test("Lucia REST transport starts once and speaks actual agent replies, not scripted patient lines", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const f = fixture(); let streams = 0;
  const service = new OperationsService({ ...f.deps,
    status: async () => ({ status: "in-progress" }),
    startStream: async (_sid, url) => { streams++; assert.match(url, /^wss:\/\/voice.example\/operations\/phone\//); return { ok: true, status: 201, callSid: undefined, error: undefined }; },
  });
  service.start(); await settle();
  t.mock.timers.tick(3000); await settle();
  assert.equal(streams, 1);
  class Wire extends EventEmitter {
    readyState = 1; sent: string[] = [];
    send(data: string) { this.sent.push(data); }
    close() { this.readyState = 3; this.emit("close", 1000, ""); }
  }
  const wire = new Wire();
  await service.attachPhone(wire);
  let start: any;
  f.sockets[3]!.on("message", raw => { start = JSON.parse(String(raw)); });
  wire.emit("message", JSON.stringify({ event: "start", start: { callSid: "CAreal", streamSid: "MZreal" } }));
  assert.equal(start.start.customParameters.call_id, service.snapshot().calls[3]!.id);
  assert.equal(start.start.customParameters.join, undefined);
  f.sockets[3]!.send(JSON.stringify({ event: "media", media: { payload: "audio" } }));
  assert.deepEqual(wire.sent, []);
  f.options[3]!.onMonitor?.({ type: "agent", text: "Hola, ¿en qué puedo ayudarte? <test>" });
  assert.ok(!(await (await service.fetch(new Request(f.webhook))).text()).includes("<Say"));
  const speech = await (await service.fetch(new Request(f.webhook, { method: "POST" }))).text();
  assert.ok(speech.includes("Hola, ¿en qué puedo ayudarte? &lt;test&gt;"));
  assert.ok(!speech.includes("Llamaba para pedir"));
  assert.ok(!(await (await service.fetch(new Request(f.webhook, { method: "POST" }))).text()).includes("<Say"));
  t.mock.timers.tick(3000); await settle(); assert.equal(streams, 1);
  await service.stop();
});

test("REST stream rejection ends only the phone, keeping AI patients alive", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const f = fixture();
  const service = new OperationsService({ ...f.deps,
    status: async () => ({ status: "in-progress" }),
    startStream: async () => ({ ok: false, status: 403, error: "Stream not permitted", callSid: undefined }),
  });
  service.start(); await settle();
  t.mock.timers.tick(3000); await settle();
  assert.ok(service.snapshot().calls[3]!.events.some(event => event.text === "Stream not permitted"));
  assert.ok(f.hungup >= 1);
  assert.equal(service.snapshot().state, "running");
  assert.ok(f.sockets.every(socket => socket.readyState === 1));
  assert.ok(service.snapshot().calls[3]!.ended);
  await service.stop();
});

test("definitive phone rejection does not cancel the three AI conversations", async () => {
  const f = fixture();
  const service = new OperationsService({ ...f.deps, dial: async () => { throw new TwilioRequestError(400, 21215); } });
  service.start(); await settle();
  assert.equal(service.snapshot().state, "running");
  assert.match(service.snapshot().message, /21215/);
  assert.ok(service.snapshot().calls[3]!.ended);
  assert.ok(f.sockets.every(socket => socket.readyState === 1));
  f.options[0]!.onMonitor?.({ type: "agent", text: "La conversación continúa" });
  assert.ok(service.snapshot().calls[0]!.events.some(event => event.text === "La conversación continúa"));
  await service.stop();
});
test("rehearsal without phone opens only three text sessions", async () => {
  const f = fixture(); const service = new OperationsService(f.deps);
  service.start(false); await settle();
  assert.equal(f.dialed, 0); assert.equal(f.options.length, 3);
  await service.stop();
});
