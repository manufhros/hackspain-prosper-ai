import { expect, test } from "bun:test";
import { installationCommands, killOwned, LocalRuntime, streamLines } from "../src/voice/runtime";
import { clinicClient, DEFAULT_PLATFORM, environmentPlatform } from "../src/voice/platform";
import { modelConfig, runtimeExecutables } from "../src/voice/model";
import { localSettings } from "../src/voice/settings";
import { assets } from "../src/voice/assets";

test("installation plan uses isolated Python 3.12 and the locked dependency file", () => {
  const commands = installationCommands("/bin/uv", "/private/venv/bin/python", "/private");
  expect(commands[0]).toEqual(["/bin/uv", "venv", "--allow-existing", "--python", "3.12", "/private/venv"]);
  expect(commands[1]!.slice(0, 5)).toEqual(["/bin/uv", "pip", "sync", "--python", "/private/venv/bin/python"]);
  expect(commands[1]!.at(-1)).toEndWith("/local-voice/requirements.txt");
  expect(assets.filter(a => a.sha256)).toHaveLength(4);
  expect(assets.every(a => a.url.startsWith("https://huggingface.co/") && !a.url.includes("/main/"))).toBe(true);
});
test("cleanup targets only owned process groups and construction does not start services", async () => {
  const kills: [number, unknown][] = [];
  killOwned(12345, (pid, signal) => { kills.push([pid, signal]); return true; });
  expect(kills).toEqual([[-12345, "SIGTERM"]]);
  expect(() => killOwned(1, () => { throw new Error("ESRCH"); })).not.toThrow();
  const runtime = new LocalRuntime();
  expect(runtime.state).toBe("idle"); runtime.stop(); expect(runtime.state).toBe("stopped");
  await expect(runtime.start()).rejects.toThrow("stopped");
});
test("JSON-lines parser tolerates arbitrary byte boundaries and final unterminated lines", async () => {
  const bytes = new TextEncoder().encode(' {"text":"mañana"}\n\n{"ready":true}');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } });
  const parsed: unknown[] = [];
  await streamLines(stream, line => parsed.push(JSON.parse(line)));
  expect(parsed).toEqual([{ text: "mañana" }, { ready: true }]);
});
test("oversized worker output is rejected", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2097153).fill(65)); controller.close(); } });
  await expect(streamLines(stream, () => {})).rejects.toThrow("oversized");
});
test(".env credentials choose their own Prosper origin instead of an unrelated saved host", async () => {
  expect(environmentPlatform({})).toEqual({ origin: DEFAULT_PLATFORM, key: null });
  const client = await clinicClient({ origin: "https://unrelated.test", endpoint: "" }, { PLATFORM_API_KEY: " synthetic-key " });
  expect(client.origin).toBe(DEFAULT_PLATFORM);
  const configured = await clinicClient({ origin: "https://unrelated.test", endpoint: "" }, { PLATFORM_API_KEY: "synthetic-key", PLATFORM_API_BASE_URL: "https://clinic.test" });
  expect(configured.origin).toBe("https://clinic.test");
  expect(() => environmentPlatform({ PLATFORM_API_BASE_URL: "https://clinic.test/api/redoc" })).toThrow("origin");
});

test("recognition-only construction and executable selection need no language-model provider", () => {
  const settings = localSettings({});
  expect(runtimeExecutables(modelConfig({}), "llama", true)).toEqual(["uv"]);
  expect(runtimeExecutables(modelConfig({}), "ollama", true)).toEqual(["uv"]);
  const runtime = new LocalRuntime(() => {}, { recognitionOnly: true, settings });
  expect(runtime.state).toBe("idle"); expect(runtime.modelLabel).toContain("recognition only");
  expect(runtime.settings).toEqual(settings); runtime.stop();
});
