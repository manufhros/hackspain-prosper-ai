import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenRouterTranscription, transcriptionConfig } from "../src/voice/transcription";
import { audioRuntimePlan, LocalRuntime } from "../src/voice/runtime";
import { localSettings } from "../src/voice/settings";
import { muLawWav } from "../src/voice/audio-wav";
import { SharedAudio } from "../src/telephony/audio";
import { recognitionProfiles } from "../src/voice/recognition-check";

const config = (concurrency = 20) => transcriptionConfig({ ASR_PROVIDER: "openrouter", OPENROUTER_ASR_CONCURRENCY: String(concurrency) }) as Extract<ReturnType<typeof transcriptionConfig>, { provider: "openrouter" }>;
const payload = Buffer.alloc(8000, 160).toString("base64");
const signal = () => new AbortController().signal;
const stub = (fn: (url: string, init: RequestInit) => Promise<Response>) => fn as typeof fetch;

test("transcription is opt-in and independent of chat; hosted plans load no Whisper", () => {
  expect(transcriptionConfig({ OPENROUTER_API_KEY: "synthetic" })).toEqual({ provider: "local", concurrency: 1 });
  for (const env of [{ ASR_PROVIDER: "groq" }, { ASR_PROVIDER: "openrouter", OPENROUTER_ASR_CONCURRENCY: "0" },
    { ASR_PROVIDER: "openrouter", OPENROUTER_ASR_CONCURRENCY: "21" }, { ASR_PROVIDER: "openrouter", OPENROUTER_ASR_TIMEOUT_MS: "NaN" }])
    expect(() => transcriptionConfig(env)).toThrow();
  const settings = localSettings({});
  const plan = audioRuntimePlan(settings, config());
  expect(plan.roles).toEqual(["capture", "tts", "tts"]);
  expect(plan.assets.some(asset => asset.path.startsWith("whisper"))).toBe(false);
  expect(plan.assets.some(asset => asset.path.startsWith("voices/"))).toBe(true);
  expect(audioRuntimePlan(settings, config(), true)).toEqual({ assets: [], roles: [] });
  expect(audioRuntimePlan(settings, transcriptionConfig({}), true).roles).toEqual(["asr"]);
  const runtime = new LocalRuntime(() => {}, { settings, transcription: config() });
  expect(runtime.state).toBe("idle"); expect(runtime.recognitionConcurrency).toBe(20);
  expect(runtime.cancellableRecognition).toBe(true); runtime.stop();
  expect(recognitionProfiles({})).toHaveLength(4);
  expect(recognitionProfiles({ ASR_PROVIDER: "openrouter" })).toHaveLength(1);
});

test("OpenRouter ASR sends WAV via the documented endpoint without pretending to pin Groq", async () => {
  const api = new OpenRouterTranscription(config(), "synthetic-key", "/unused", stub(async (url, init) => {
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(init.redirect).toBe("error"); expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("openai/whisper-large-v3-turbo");
    expect(body.response_format).toBe("verbose_json"); expect(body.input_audio.format).toBe("wav");
    expect(body).not.toHaveProperty("provider"); expect(body).not.toHaveProperty("language");
    expect(body).not.toHaveProperty("prompt"); expect(body).not.toHaveProperty("reference");
    expect(Buffer.from(body.input_audio.data, "base64").equals(muLawWav(payload))).toBe(true);
    return Response.json({ text: " Hola clínica ", language: "catalan", provider: "Groq",
      usage: { cost: 0.001, seconds: 1, secret: "omit", input_tokens: -1 } }, { headers: { "X-Generation-Id": "gen-test" } });
  }));
  const heard = await api.audio("transcribe_mulaw", { payload }, signal());
  expect(heard.text).toBe("Hola clínica"); expect(heard.language).toBe("ca"); expect(heard.decoder).toBe("openrouter");
  expect(heard.metrics).toEqual({ gateway: "openrouter", model: "openai/whisper-large-v3-turbo", routing: "OpenRouter-managed",
    provider: "Groq", generation_id: "gen-test", cost: 0.001, seconds: 1 });
});

test("explicit hints are optional and missing provider language remains unknown", async () => {
  const api = new OpenRouterTranscription(config(), "synthetic", "/unused", stub(async (_url, init) => {
    expect(JSON.parse(String(init.body)).language).toBe("ca");
    return Response.json({ text: "Hola" });
  }));
  expect((await api.audio("transcribe_mulaw", { payload, language: "ca" }, signal())).language).toBe("unknown");
  await expect(api.audio("transcribe_mulaw", { payload, language: "expected reference text" }, signal())).rejects.toThrow("two-letter");
});

test("private WAV captures upload; traversal, symlinks and malformed audio never reach provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "asr-test-"));
  let requests = 0;
  const api = new OpenRouterTranscription(config(), "synthetic", dir, stub(async () => { requests++; return Response.json({ text: "Hello", language: "english" }); }));
  try {
    await Bun.write(join(dir, "speech.wav"), muLawWav(payload));
    expect((await api.audio("transcribe", { file: "speech.wav" }, signal())).language).toBe("en");
    await Bun.write(join(dir, "bad.wav"), "not audio");
    await symlink("/etc/hosts", join(dir, "outside.wav"));
    for (const file of ["../speech.wav", "outside.wav", "bad.wav"])
      await expect(api.audio("transcribe", { file }, signal())).rejects.toThrow();
    await expect(api.audio("transcribe_mulaw", { payload: "!bad" }, signal())).rejects.toThrow();
    expect(requests).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HTTP and malformed responses fail without retries or leaking provider bodies", async () => {
  for (const response of [new Response("sensitive body", { status: 429 }), new Response("sensitive body"),
    Response.json({ text: 123 }), Response.json({ error: "sensitive body" })]) {
    let requests = 0;
    const api = new OpenRouterTranscription(config(), "synthetic", "/unused", stub(async () => { requests++; return response; }));
    try { await api.audio("transcribe_mulaw", { payload }, signal()); throw Error("Expected failure"); }
    catch (error) { expect(String(error)).not.toContain("sensitive body"); expect(String(error)).toContain("OpenRouter transcription"); }
    expect(requests).toBe(1);
  }
});

test("hosted recognition overlaps up to capacity and caller cancellation does not affect other calls", async () => {
  const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  const api = new OpenRouterTranscription(config(2), "synthetic", "/unused", stub(async (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      requests.push({ signal: init.signal!, resolve });
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    })));
  const lifetime = new AbortController(), caller = new AbortController(), queuedCaller = new AbortController();
  const shared = new SharedAudio({ audio: api.audio.bind(api), recognitionConcurrency: 2, cancellableRecognition: true }, lifetime.signal);
  const a = shared.run("transcribe_mulaw", { payload }, caller.signal);
  const b = shared.run("transcribe_mulaw", { payload }, signal());
  const c = shared.run("transcribe_mulaw", { payload }, queuedCaller.signal);
  const cancelled = a.catch(error => error); const queuedCancelled = c.catch(error => error);
  await Bun.sleep(0); expect(requests).toHaveLength(2);
  queuedCaller.abort(); caller.abort();
  expect(await cancelled).toBeInstanceOf(Error); expect(await queuedCancelled).toBeInstanceOf(Error); await Bun.sleep(0);
  expect(requests[0]!.signal.aborted).toBe(true); expect(requests[1]!.signal.aborted).toBe(false);
  expect(requests).toHaveLength(2);
  requests[1]!.resolve(Response.json({ text: "Hola", language: "spanish" }));
  expect((await b).language).toBe("es");
});

test("remote timeout aborts the request once without automatic retries", async () => {
  let requests = 0;
  const api = new OpenRouterTranscription({ ...config(), timeoutMs: 10 }, "synthetic", "/unused", stub(async (_url, init) => {
    requests++; return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
  }));
  await expect(api.audio("transcribe_mulaw", { payload }, signal())).rejects.toThrow("timed out");
  expect(requests).toBe(1);
});
