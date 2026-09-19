import { expect, test } from "bun:test";
import { WorkQueue } from "../src/voice/queue";
import { localSettings } from "../src/voice/settings";
import { OllamaChat } from "../src/voice/ollama";
import { SharedAudio } from "../src/telephony/audio";
import { speechAssets } from "../src/voice/assets";

const signal = () => new AbortController().signal;
const tick = () => Bun.sleep(0);

test("local inference bounds active jobs and removes cancelled queued jobs", async () => {
  const queue = new WorkQueue(2, 2), releases: (() => void)[] = [];
  let starts = 0;
  const work = () => { starts++; return new Promise<void>(resolve => releases.push(resolve)); };
  const a = queue.run(work, signal()), b = queue.run(work, signal());
  const cancel = new AbortController();
  const c = queue.run(work, cancel.signal);
  const d = queue.run(work, signal());
  await expect(queue.run(work, signal())).rejects.toThrow("full");
  await tick(); expect(starts).toBe(2);
  cancel.abort(new Error("Caller left")); await expect(c).rejects.toThrow("Caller left");
  releases.shift()!(); await a; await tick(); expect(starts).toBe(3);
  releases.shift()!(); releases.shift()!(); await Promise.all([b, d]);
});

test("separate speech lanes allow recognition during two syntheses without exceeding capacity", async () => {
  const releases: (() => void)[] = [], started: string[] = [];
  const audio = new SharedAudio({ audio: async op => {
    started.push(op); await new Promise<void>(resolve => releases.push(resolve)); return { elapsed_ms: 1 };
  } }, signal(), 2);
  const a = audio.run("speak", {}, signal()), b = audio.run("speak", {}, signal());
  const c = audio.run("speak", {}, signal()), d = audio.run("transcribe_mulaw", {}, signal());
  await tick(); expect(started).toEqual(["speak", "speak", "transcribe_mulaw"]);
  releases.shift()!(); await a; await tick(); expect(started).toHaveLength(4);
  releases.splice(0).forEach(release => release()); await Promise.all([b, c, d]);
});

test("Ollama uses bounded local settings and exposes timing and token telemetry", async () => {
  const settings = localSettings({ LOCAL_LLM_PARALLEL: "4" });
  const model = new OllamaChat("http://127.0.0.1:1234", settings, async (_url, init) => {
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "qwen3.5:4b", think: false, options: { num_ctx: 16384, num_predict: 512 } });
    expect(body).not.toHaveProperty("tools");
    return Response.json({ message: { role: "assistant", content: "Hola" }, done_reason: "stop",
      eval_duration: 100000000, prompt_eval_duration: 50000000, prompt_eval_count: 30, eval_count: 2 });
  });
  const reply = await model.chat([{ role: "user", content: "Hola" }], [], signal());
  expect(reply.metrics).toMatchObject({ provider: "local", decode_ms: 100, prefill_ms: 50, prompt_tokens: 30, completion_tokens: 2 });
});

test("truncated local responses never become speech or actions", async () => {
  const model = new OllamaChat("http://127.0.0.1:1234", localSettings({}), async () => Response.json({
    message: { role: "assistant", content: '{"actions":[' }, done_reason: "length",
  }));
  await expect(model.chat([], [], signal())).rejects.toThrow("truncated");
});

test("invalid capacities fail before starting processes; ASR variants cannot share weight directories", () => {
  for (const env of [{ LOCAL_LLM_PARALLEL: "20" }, { LOCAL_TTS_WORKERS: "0" }, { LOCAL_TTS_THREADS: "NaN" }, { LOCAL_ASR_MODEL: "tiny.en" }, { LOCAL_ASR_DECODER: "auto" }]) {
    expect(() => localSettings(env)).toThrow();
  }
  expect(speechAssets("large-v3-turbo").some(asset => asset.path.startsWith("whisper/"))).toBe(false);
  expect(speechAssets("large-v3-turbo").find(asset => asset.path.endsWith("safetensors"))?.sha256).toHaveLength(64);
});
