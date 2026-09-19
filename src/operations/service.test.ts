import test from "node:test";
import assert from "node:assert/strict";
import { liveStreamTwiml } from "../agent/twilio-transfer.ts";
import { OperationsService } from "./service.ts";
import { authorized, phoneToken, validPhoneToken } from "./security.ts";
import type { CallOptions } from "../agent/session.ts";
import type { CallSocket } from "../agent/socket.ts";
import { checkPhone, dialPatient, TwilioRequestError } from "./twilio.ts";

const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function fixture() {
  for (const key of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "PLATFORM_API_KEY"]) process.env[key] = "test";
  process.env.OPERATIONS_SECRET = "s".repeat(40);
  process.env.TWILIO_HUMAN_NUMBER = "+34600000123";
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
test("three concurrent patients use Lucia core; phone uses Guille exact playback", async () => {
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
  assert.equal(xml, liveStreamTwiml("wss://voice.example/ws", service.snapshot().calls[3]!.id, "arenal"));
  assert.equal(response.headers.get("x-operations-call-id"), service.snapshot().calls[3]!.id);
  assert.ok(!xml.includes("<Stream"));
  assert.ok(xml.includes("Llamaba para pedir la primera cita"));
  assert.equal(f.options.length, 3);
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
test("phone creation uses exactly Lucia's trial-compatible parameters", async t => {
  process.env.TWILIO_ACCOUNT_SID = "test"; process.env.TWILIO_AUTH_TOKEN = "test";
  process.env.TWILIO_PHONE_NUMBER = "+12025550123";
  process.env.TWILIO_HUMAN_NUMBER = "+34600000456";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    assert.deepEqual(Object.fromEntries(init!.body as URLSearchParams), {
      To: "+34600000456", From: "+12025550123", Url: "https://voice.example/phone",
    });
    return Response.json({ sid: "CA" + "a".repeat(32), status: "queued" });
  });
  assert.ok((await dialPatient("https://voice.example/phone")).sid);
});

test("account preflight allows Trial to attempt the actual REST transport", async t => {
  process.env.TWILIO_ACCOUNT_SID = "test"; process.env.TWILIO_AUTH_TOKEN = "test"; process.env.TWILIO_PHONE_NUMBER = "+12025550123";
  t.mock.method(globalThis, "fetch", async () => Response.json({ type: "Trial" }));
  await assert.doesNotReject(checkPhone());
});

test("phone serves speech immediately, without REST streams or a fourth agent", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const f = fixture();
  let status = "in-progress";
  const service = new OperationsService({ ...f.deps, status: async () => ({ status }) });
  service.start(); await settle();
  const preflight = await service.fetch(new Request(f.webhook));
  assert.equal(service.snapshot().calls[3]!.state, "Llamando");
  const playback = await service.fetch(new Request(f.webhook, { method: "POST" }));
  assert.equal(await playback.text(), await preflight.text());
  assert.equal(service.snapshot().calls[3]!.state, "Reproducción de prueba");
  t.mock.timers.tick(3000); await settle();
  assert.equal(f.options.length, 3);
  assert.equal(f.hungup, 0);
  assert.ok(f.sockets.every(socket => socket.readyState === 1));
  status = "completed";
  t.mock.timers.tick(3000); await settle();
  assert.equal(service.snapshot().calls[3]!.state, "Finalizada");
  assert.ok(!service.snapshot().calls[3]!.events.some(event => event.type === "error"));
  await service.stop();
  assert.equal(f.hungup, 0);
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
