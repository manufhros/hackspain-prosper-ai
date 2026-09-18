import { expect, test } from "bun:test";
import { OpenRouterChat, openRouterMessages } from "../src/voice/openrouter";
import { childEnvironment, modelConfig, openRouterKey, openRouterKeyIdentity, runtimeExecutables } from "../src/voice/model";
import { Receptionist } from "../src/voice/agent";
import { type Inference, type Message } from "../src/voice/runtime";

const config = { provider: "openrouter" as const, model: "test/model", maxTokens: 4096 };
const secret = "synthetic-test-key";
const signal = () => new AbortController().signal;
const response = (message: unknown, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message }] });
const say = (content: string) => ({ role: "assistant", content });
const tool = (id = "call_1", args = '{}') => ({ id, type: "function", function: { name: "clinic", arguments: args } });

test("provider configuration defaults local and OpenRouter never requires Ollama", () => {
  expect(modelConfig({})).toEqual({ provider: "local", model: "qwen3.5:4b" });
  expect(runtimeExecutables(modelConfig({}))).toEqual(["uv", "ollama"]);
  expect(modelConfig({ LLM_PROVIDER: "openrouter", OPENROUTER_MODEL: "test/model" })).toEqual(config);
  expect(runtimeExecutables(config)).toEqual(["uv"]);
  for (const env of [{ LLM_PROVIDER: "typo" }, { LLM_PROVIDER: "openrouter" }, { LLM_PROVIDER: "openrouter", OPENROUTER_MODEL: "bad model" },
    { LLM_PROVIDER: "openrouter", OPENROUTER_MODEL: "test/model", OPENROUTER_MAX_TOKENS: "NaN" }]) expect(() => modelConfig(env)).toThrow();
});

test("OpenRouter credentials come from their own Keychain entry and never reach child processes", async () => {
  expect(await openRouterKey(async identity => { expect(identity).toEqual(openRouterKeyIdentity); return secret; })).toBe(secret);
  await expect(openRouterKey(async () => null)).rejects.toThrow("Setup");
  expect(childEnvironment({ PATH: "/bin", PLATFORM_API_KEY: "clinic", VOICE_SERVER_TOKEN: "server", OPENROUTER_API_KEY: secret })).toEqual({ PATH: "/bin" });
});

test("OpenRouter requests use the selected model, fixed HTTPS host, bearer auth and no redirects", async () => {
  const router = new OpenRouterChat(config, secret, async (url, init) => {
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.redirect).toBe("error"); expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${secret}`);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test/model"); expect(body.stream).toBe(false); expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("options"); expect(body).not.toHaveProperty("think");
    expect(body.provider.require_parameters).toBe(true);
    expect(body.tools).toHaveLength(1); expect(body.parallel_tool_calls).toBe(false);
    expect(String(init.body)).not.toContain(secret);
    return response(say("Hello"));
  });
  expect((await router.chat([{ role: "user", content: "Hello" }], [{ type: "function" }], signal())).message.content).toBe("Hello");
});

test("tool-only responses decode arguments and round-trip IDs and opaque reasoning unchanged", async () => {
  const reasoning = [{ type: "reasoning.encrypted", data: "opaque-signature", index: 0 }];
  const rawArguments = '{ "name": "Carmen" }';
  const router = new OpenRouterChat(config, secret, async () => response({ role: "assistant", content: null,
    tool_calls: [tool("call_1", rawArguments), tool("call_2")], reasoning_details: reasoning }, "tool_calls"));
  const reply = (await router.chat([{ role: "user", content: "Help" }], [], signal())).message;
  expect(reply.content).toBe(""); expect(reply.tool_calls![0]!.function.arguments).toEqual({ name: "Carmen" });
  const wire = openRouterMessages([reply, { role: "tool", tool_call_id: "call_1", tool_name: "clinic", content: "{}" },
    { role: "tool", tool_call_id: "call_2", content: "{}" }]);
  expect(wire[0]).toMatchObject({ content: null, reasoning_details: reasoning, tool_calls: [tool("call_1", rawArguments), tool("call_2")] });
  expect(wire[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: "{}" });
  expect(() => openRouterMessages([reply])).toThrow("unanswered");
  expect(() => openRouterMessages([{ role: "tool", tool_call_id: "other", content: "{}" }])).toThrow("matching");
});

test("structured smoke output uses response_format without mutating the source schema", async () => {
  const schema = { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"] };
  const router = new OpenRouterChat(config, secret, async (_url, init) => {
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty("tools"); expect(body).not.toHaveProperty("format");
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "voice_response", strict: true, schema: { ...schema, additionalProperties: false } } });
    return response(say('{"ready":true}'));
  });
  await router.chat([{ role: "user", content: "Ready?" }], [], signal(), schema);
  expect(schema).not.toHaveProperty("additionalProperties");
});

test("HTTP, provider and malformed responses fail without leaking upstream bodies or tool arguments", async () => {
  for (const status of [400, 401, 402, 404, 429, 500]) {
    const router = new OpenRouterChat(config, secret, async () => new Response(secret, { status }));
    await expect(router.chat([], [], signal())).rejects.toThrow(`HTTP ${status}`);
  }
  const malformed = [
    () => Response.json({ error: { message: secret } }),
    () => response(say(secret), "length"),
    () => response({ role: "assistant", content: null, tool_calls: [tool("x", secret)] }, "tool_calls"),
    () => response({ role: "assistant", content: null, tool_calls: [tool("x", "[]")] }, "tool_calls"),
    () => response({ role: "assistant", content: null, tool_calls: [tool("x"), tool("x")] }, "tool_calls"),
    () => response({ role: "assistant", content: null }),
    () => new Response("not JSON"),
  ];
  for (const makeResponse of malformed) {
    const router = new OpenRouterChat(config, secret, async () => makeResponse());
    let failure: unknown;
    try { await router.chat([], [], signal()); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error); expect(String(failure)).not.toContain(secret);
  }
});

test("caller cancellation propagates to the pending remote request without retrying", async () => {
  const abort = new AbortController(); let requests = 0;
  const router = new OpenRouterChat(config, secret, async (_url, init) => {
    requests++;
    return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const pending = router.chat([], [], abort.signal); abort.abort(new Error("Call ended"));
  await expect(pending).rejects.toThrow("Call ended"); expect(requests).toBe(1);
});

test("the receptionist executes OpenRouter tools and sends results with matching IDs", async () => {
  const requests: unknown[] = [];
  const router = new OpenRouterChat(config, secret, async (_url, init) => {
    const body = JSON.parse(String(init.body)); requests.push(body);
    if (requests.length === 1) return response({ role: "assistant", content: null, tool_calls: [tool("clinic_read")] }, "tool_calls");
    expect(body.messages.find((m: Message) => m.role === "tool")).toMatchObject({ tool_call_id: "clinic_read", content: '{"clinic_name":"Arenal"}' });
    return response(say("How can I help you?"));
  });
  let clinicReads = 0;
  const inference: Inference = { chat: (...args) => router.chat(...args), async audio() { throw new Error("No audio"); }, async removeAudio() {} };
  const agent = new Receptionist(inference, { async request() { clinicReads++; return { status: 200, elapsed_ms: 0, meaning: "OK", data: { clinic_name: "Arenal" } }; } }, "2026-09-18T09:00:00+02:00", "en");
  expect(await agent.turn("Hello", signal())).toBe("How can I help you?");
  expect(requests).toHaveLength(2); expect(clinicReads).toBe(1);
});
