import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleCall } from "../agent/session.ts";
import { DEFAULT_RUNTIME_CONFIG } from "../agent/runtime-config.ts";

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", code, reason);
  }
  message(value) { this.emit("message", JSON.stringify(value)); }
}

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test("shared call engine bridges audio and finalizes once across stop and close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  process.env.VOICE_STORAGE = "d1";
  process.env.PLATFORM_API_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "test";
  t.mock.method(globalThis, "fetch", async (url) => String(url).includes("/directory")
    ? Response.json({ matches: [{ patient_id: "P01", given_name: "María", first_surname: "García", second_surname: "López", insurer: "sanitas" }] })
    : Response.json({ signed_url: "wss://example.test" }));
  const twilio = new Socket();
  const eleven = new Socket();
  const events = [];
  const tasks = [];
  let connections = 0;
  let ended = 0;
  await handleCall(twilio, {
    connect: async () => { connections++; return eleven; },
    onEnd: () => { ended++; },
    loadConfig: async () => ({ ...DEFAULT_RUNTIME_CONFIG, version: "test-v1",
      metaPrompt: "Speak warmly.", extraInstructions: "Ask for the preferred site.", voiceId: "published-voice" }),
    emitEvent: (type, callId, configVersion, payload) => { const event = { type, callId, configVersion, payload }; events.push(event); return event; },
    waitUntil: (task) => tasks.push(task),
  });
  const start = { event: "start", start: { streamSid: "stream", callSid: "call", customParameters: { org_slug: "sanitas", from_number: "+34600000000" } } };
  twilio.message(start);
  twilio.message(start);
  twilio.message({ event: "media", media: { payload: "queued-audio" } });
  await settle();
  for (let i = 0; i < 10 && !connections; i++) await settle();
  assert.equal(connections, 1);
  assert.equal(eleven.sent[0].dynamic_variables.config_version, "test-v1");
  const initiation = eleven.sent[0];
  assert.equal(initiation.conversation_config_override.tts.voice_id, "published-voice");
  assert.match(initiation.conversation_config_override.agent.prompt.prompt, /Speak warmly\./);
  assert.match(initiation.conversation_config_override.agent.prompt.prompt, /Ask for the preferred site\./);
  assert.equal(initiation.dynamic_variables.meta_prompt, "Speak warmly.");
  assert.ok(eleven.sent.some((message) => message.user_audio_chunk === "queued-audio"));
  eleven.message({ type: "audio", audio_event: { audio_base_64: "reply-audio" } });
  assert.ok(twilio.sent.some((message) => message.media?.payload === "reply-audio"));
  eleven.message({ type: "agent_response", agent_response_event: { agent_response: "Buenos días." } });
  twilio.message({ event: "stop" });
  twilio.close();
  await settle();
  t.mock.timers.tick(8_000);
  await Promise.all(tasks);
  assert.equal(events.filter((event) => event.type === "call.ended").length, 1);
  assert.equal(events.find((event) => event.type === "call.ended").payload.orgSlug, "sanitas");
  assert.equal(events.find((event) => event.type === "conversation.agent").payload.text, "Buenos días.");
  assert.equal(events.find((event) => event.type === "call.ended").payload.patientName, "María García López");
  assert.equal(events.find((event) => event.type === "crm.lookup.completed").payload.patientId, "P01");
  assert.equal(ended, 1);
  assert.equal(eleven.readyState, 3);
});

test("invalid start frames close without opening an upstream socket", async () => {
  const twilio = new Socket();
  await handleCall(twilio, { connect: async () => { throw new Error("must not connect"); } });
  twilio.message({ event: "start" });
  assert.equal(twilio.readyState, 3);
});

test("disconnect during upstream connection closes the late socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  process.env.VOICE_STORAGE = "d1";
  process.env.PLATFORM_API_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "test";
  t.mock.method(globalThis, "fetch", async () => Response.json({ signed_url: "wss://example.test" }));
  const twilio = new Socket();
  const eleven = new Socket();
  const tasks = [];
  let completeConnection;
  await handleCall(twilio, {
    connect: () => new Promise((resolve) => { completeConnection = resolve; }),
    loadConfig: async () => DEFAULT_RUNTIME_CONFIG,
    emitEvent: () => ({}),
    waitUntil: (task) => tasks.push(task),
  });
  twilio.message({ event: "start", start: { streamSid: "stream", callSid: "call" } });
  await settle();
  assert.ok(completeConnection);
  twilio.close();
  completeConnection(eleven);
  await Promise.all(tasks);
  t.mock.timers.tick(8_000);
  assert.equal(eleven.readyState, 3);
  assert.deepEqual(eleven.sent, []);
});

async function liveCall(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  process.env.VOICE_STORAGE = "d1";
  process.env.PLATFORM_API_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "test";
  t.mock.method(globalThis, "fetch", async () => Response.json({ signed_url: "wss://example.test" }));
  const { LiveBridge } = await import("../agent/live-bridge.ts");
  const bridge = new LiveBridge();
  const caller = new Socket();
  const eleven = new Socket();
  const events = [];
  const tasks = [];
  const options = {
    liveBridge: bridge,
    connect: async () => eleven,
    loadConfig: async () => DEFAULT_RUNTIME_CONFIG,
    emitEvent: (type, callId, version, payload) => { events.push({ type, callId, payload }); return {}; },
    waitUntil: (task) => tasks.push(task),
  };
  await handleCall(caller, options);
  caller.message({ event: "start", start: { streamSid: "original", callSid: "live" } });
  await settle();
  return { bridge, caller, eleven, events, tasks, options };
}

test("phone joins the existing agent and survives caller disconnect with a single final summary", async (t) => {
  const { bridge, caller, eleven, events, tasks, options } = await liveCall(t);
  bridge.markHumanRung("live");
  const phone = new Socket();
  await handleCall(phone, { ...options, joinOnly: true });
  const start = { event: "start", start: { streamSid: "phone", callSid: "outbound", customParameters: { join: "live" } } };
  phone.message(start);
  phone.message(start);
  phone.message({ event: "media", media: { payload: "human-audio" } });
  assert.ok(eleven.sent.some((message) => message.user_audio_chunk === "human-audio"));
  eleven.message({ type: "audio", audio_event: { audio_base_64: "reply" } });
  assert.equal(phone.sent.filter((message) => message.media?.payload === "reply").length, 1);
  assert.ok(caller.sent.some((message) => message.media?.payload === "reply"));
  caller.close();
  await settle();
  assert.equal(events.filter((event) => event.type === "call.ended").length, 0);
  t.mock.timers.tick(181_000);
  phone.close();
  await settle();
  t.mock.timers.tick(8_000);
  await Promise.all(tasks);
  assert.equal(events.filter((event) => event.type === "handoff.phone.joined").length, 1);
  assert.equal(events.filter((event) => event.type === "handoff.phone.left").length, 1);
  assert.equal(events.filter((event) => event.type === "call.ended").length, 1);
  assert.equal(bridge.getLiveSession("live"), undefined);
  assert.equal(bridge.alreadyRungHuman("live"), false);
  assert.equal(bridge.hasPhoneJoined("live"), false);
  assert.equal(eleven.readyState, 3);
});

test("confirming the nine o'clock slot on the phone still gets an agent reply", async (t) => {
  const { bridge, caller, eleven, options } = await liveCall(t);
  const phone = new Socket();
  await handleCall(phone, { ...options, joinOnly: true });
  phone.message({ event: "start", start: { streamSid: "phone", callSid: "outbound", customParameters: { join: "live" } } });
  assert.ok(eleven.sent.some((message) => message.type === "user_message" && String(message.text).includes("medicina general")));
  eleven.message({ type: "audio", audio_event: { audio_base_64: "slot-offer" } });
  assert.ok(phone.sent.some((message) => message.media?.payload === "slot-offer"));
  eleven.message({ type: "user_transcript", user_transcription_event: { user_transcript: "Sí, le viene bien a las 9" } });
  const helper = [...caller.sent].reverse().find((message) => message.monitor?.type === "helper");
  assert.match(String(helper?.monitor?.text ?? ""), /9/);
  eleven.message({ type: "agent_response", agent_response_event: { agent_response: "Perfecto, le confirmo las nueve." } });
  eleven.message({ type: "audio", audio_event: { audio_base_64: "confirmed" } });
  assert.ok(phone.sent.some((message) => message.media?.payload === "confirmed"));
  assert.ok(caller.sent.some((message) => message.monitor?.type === "agent" && String(message.monitor.text).includes("nueve")));
});

test("an unanswered handoff expires after the caller disconnects", async (t) => {
  const { bridge, caller, eleven, events, tasks } = await liveCall(t);
  bridge.markHumanRung("live");
  caller.close();
  await settle();
  t.mock.timers.tick(180_001);
  await settle();
  t.mock.timers.tick(8_000);
  await Promise.all(tasks);
  assert.equal(events.filter((event) => event.type === "call.ended").length, 1);
  assert.equal(bridge.getLiveSession("live"), undefined);
  assert.equal(eleven.readyState, 3);
});

test("missing joins and joins into another Durable Object never start a new agent", async (t) => {
  const { LiveBridge } = await import("../agent/live-bridge.ts");
  const { bridge, caller, tasks, options } = await liveCall(t);
  const isolated = new LiveBridge();
  for (const customParameters of [{ join: "live" }, {}]) {
    const phone = new Socket();
    await handleCall(phone, { ...options, liveBridge: isolated, joinOnly: true, connect: async () => { assert.fail("must not connect"); } });
    phone.message({ event: "start", start: { streamSid: "phone", callSid: "outbound", customParameters } });
    assert.equal(phone.readyState, 1);
    phone.close();
  }
  assert.ok(bridge.getLiveSession("live"));
  caller.close();
  await settle();
  t.mock.timers.tick(8_000);
  await Promise.all(tasks);
});

test("delayed handoff uses the call's registry and remains tracked until Twilio responds", async (t) => {
  const { LiveBridge, nodeLiveBridge } = await import("../agent/live-bridge.ts");
  const { runClinicTool } = await import("../agent/tools.ts");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_HUMAN_NUMBER", "TWILIO_PHONE_NUMBER"];
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key) => { process.env[key] = "test"; });
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(init.body);
    return Response.json({ sid: "outbound" });
  });
  const bridge = new LiveBridge();
  const tasks = [];
  const events = [];
  const ctx = {
    callId: "isolated-handoff", simulationMode: true, platform: {}, liveBridge: bridge,
    handoffUrl: "https://voice.example/twiml/live/object", orgSlug: "sanitas",
    waitUntil: (task) => tasks.push(task), audit: async (type) => { events.push(type); },
  };
  await runClinicTool(ctx, "submit_escalate", { reason: "out_of_scope" });
  await runClinicTool(ctx, "submit_escalate", { reason: "out_of_scope" });
  assert.equal(tasks.length, 1);
  assert.equal(bridge.alreadyRungHuman(ctx.callId), true);
  assert.equal(nodeLiveBridge.alreadyRungHuman(ctx.callId), false);
  t.mock.timers.tick(3_199);
  await settle();
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1);
  await Promise.all(tasks);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].get("Url"), "https://voice.example/twiml/live/object?join=isolated-handoff&org=sanitas");
  assert.deepEqual(events, ["handoff.requested", "handoff.completed"]);
  assert.equal(bridge.outboundCallSid(ctx.callId), "outbound");
  bridge.unregisterLiveSession(ctx.callId);
  assert.equal(bridge.outboundCallSid(ctx.callId), undefined);
});

test("call events distinguish phone, simulator and rehearsal origins", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const keys = ["VOICE_STORAGE", "PLATFORM_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"];
  const previous = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  keys.forEach(key => { process.env[key] = key === "VOICE_STORAGE" ? "d1" : "test"; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ signed_url: "wss://example.test" }));
  for (const [id, customParameters, demo, origin] of [
    ["origin-phone", {}, false, "phone"],
    ["origin-sim", { simulation: "1" }, false, "simulator"],
    ["origin-demo", {}, true, "simulator"],
  ]) {
    const caller = new Socket();
    const eleven = new Socket();
    const events = [];
    const tasks = [];
    await handleCall(caller, {
      demo, connect: async () => eleven, loadConfig: async () => DEFAULT_RUNTIME_CONFIG,
      emitEvent: (type, callId, configVersion, payload) => { events.push({ type, payload }); return {}; },
      waitUntil: task => tasks.push(task),
    });
    caller.message({ event: "start", start: { streamSid: id, callSid: id, customParameters } });
    await settle();
    assert.equal(events.find(event => event.type === "call.started")?.payload.origin, origin);
    caller.close();
    await settle();
    t.mock.timers.tick(8_000);
    await Promise.all(tasks);
    assert.equal(events.find(event => event.type === "call.ended")?.payload.origin, origin);
  }
});
