import { expect, test } from "bun:test";
import { LlamaChat, llamaArguments, llamaCapacity } from "../src/voice/llama";
import { localSettings } from "../src/voice/settings";
import { modelConfig, runtimeExecutables } from "../src/voice/model";

const signal = () => new AbortController().signal;
const completion = (content = "Hola") => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });

test("llama capacity preserves per-slot context and rejects server-side parallelism changes", () => {
  const settings = localSettings({});
  expect(runtimeExecutables(modelConfig({}), settings.backend)).toEqual(["uv", "llama-server"]);
  expect(runtimeExecutables(modelConfig({}), "ollama")).toEqual(["uv", "ollama"]);
  const args = llamaArguments("/private/model.gguf", 4321, settings);
  expect(args[args.indexOf("--ctx-size") + 1]).toBe("65536");
  expect(args[args.indexOf("--parallel") + 1]).toBe("4");
  expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
  expect(args).toContain("--jinja"); expect(args).toContain("--cont-batching");
  expect(args).toContain("--no-context-shift");
  expect(args[args.indexOf("--reasoning") + 1]).toBe("off");
  expect(args).not.toContain("--chat-template-kwargs");
  expect(args[args.indexOf("--cors-origins") + 1]).toBe("localhost");
  expect(llamaCapacity({ total_slots: 4, default_generation_settings: { n_ctx: 16384 }, build_info: "b123" }, settings))
    .toEqual({ backend: "llama", slots: 4, context_per_slot: 16384, build: "b123" });
  for (const props of [{ total_slots: 1, default_generation_settings: { n_ctx: 16384 } },
    { total_slots: 4, default_generation_settings: { n_ctx: 4096 } }, {}]) expect(() => llamaCapacity(props, settings)).toThrow("slots/context");
  expect(() => localSettings({ LOCAL_LLM_BACKEND: "cloud" })).toThrow("LOCAL_LLM_BACKEND");
});

test("local llama tool calls roundtrip IDs and return operational timing metadata", async () => {
  let requests = 0;
  const model = new LlamaChat("http://127.0.0.1:4321", localSettings({}), async (url, init) => {
    expect(url).toBe("http://127.0.0.1:4321/v1/chat/completions");
    expect(init.headers).not.toHaveProperty("Authorization"); expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    // Thinking is disabled at server startup; requests must not override that policy.
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body.max_tokens).toBe(512);
    if (++requests === 1) {
      expect(body.parallel_tool_calls).toBe(false);
      return Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: '{"language":"ca"}' } }] } }],
        timings: { prompt_ms: 42, predicted_ms: 83, cache_n: 30 }, usage: { prompt_tokens: 100, completion_tokens: 12 } });
    }
    expect(body.messages[1].tool_calls[0].function.arguments).toBe('{"language":"ca"}');
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "call1", content: "ok" });
    expect(body.response_format.json_schema.schema.type).toBe("object");
    return completion('{"speech":"Hola"}');
  });
  const messages = [{ role: "user" as const, content: "Lookup" }];
  const reply = await model.chat(messages, [{ type: "function", function: { name: "lookup" } }], signal());
  expect(reply.metrics).toMatchObject({ backend: "llama", prefill_ms: 42, decode_ms: 83, cached_tokens: 30, prompt_tokens: 100, completion_tokens: 12 });
  expect(reply.message.tool_calls?.[0]?.function.arguments).toEqual({ language: "ca" });
  await model.chat([...messages, reply.message, { role: "tool", tool_call_id: "call1", content: "ok" }], [], signal(), { type: "object" });
});

test("llama requests overlap up to capacity; cancelling a queued call never reaches the server", async () => {
  const releases: (() => void)[] = [];
  let active = 0, peak = 0, started = 0;
  const model = new LlamaChat("http://127.0.0.1:4321", localSettings({ LOCAL_LLM_PARALLEL: "2" }), async () => {
    started++; active++; peak = Math.max(active, peak);
    await new Promise<void>(resolve => releases.push(resolve)); active--; return completion();
  });
  const a = model.chat([], [], signal()), b = model.chat([], [], signal());
  const cancel = new AbortController(), c = model.chat([], [], cancel.signal), d = model.chat([], [], signal());
  cancel.abort(new Error("Caller left")); await expect(c).rejects.toThrow("Caller left");
  expect(started).toBe(2);
  releases.shift()!(); await a; await Bun.sleep(0);
  expect(started).toBe(3); expect(peak).toBe(2);
  releases.splice(0).forEach(release => release()); await Promise.all([b, d]);
});

test("llama rejects truncation and propagates active cancellation before any action", async () => {
  const truncated = new LlamaChat("http://127.0.0.1:4321", localSettings({}), async () => Response.json({
    choices: [{ finish_reason: "length", message: { role: "assistant", content: '{"action":' } }],
  }));
  await expect(truncated.chat([], [], signal())).rejects.toThrow("LOCAL_LLM_MAX_TOKENS");
  const cancel = new AbortController();
  const cancelled = new LlamaChat("http://127.0.0.1:4321", localSettings({}), async (_url, init) => {
    expect(init.signal).toBeDefined(); cancel.abort(new Error("Caller interrupted")); return completion();
  });
  await expect(cancelled.chat([], [], cancel.signal)).rejects.toThrow("Caller interrupted");
});
