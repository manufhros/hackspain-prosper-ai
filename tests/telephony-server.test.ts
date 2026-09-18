import { expect, test } from "bun:test";
import { authorized, serverConfig, serverHandlers } from "../src/telephony/server";
import { SharedAudio, defaultVad } from "../src/telephony/audio";
import { type Inference } from "../src/voice/runtime";
import { root } from "../src/data";

const inference: Inference = { async chat() { throw new Error("Unexpected inference"); }, async audio() { throw new Error("Unexpected audio"); }, async removeAudio() {} };

test("configuration validates port, language, capacity and VAD without starting anything", () => {
  expect(serverConfig({}, [])).toMatchObject({ port: 7860, hostname: "127.0.0.1", live: true, maxCalls: 20, language: "es", vad: defaultVad });
  expect(serverConfig({}, ["--dry-run", "--port", "8888"])).toMatchObject({ live: false, port: 8888 });
  for (const args of [["--port"], ["--port", "0"], ["--port", "Infinity"], ["--mystery"]]) expect(() => serverConfig({}, args)).toThrow();
  for (const env of [{ VOICE_TURN_TIMEOUT_MS: "0" }, { VOICE_WAIT_NOTICE_MS: "NaN" }, { VOICE_CALL_TIMEOUT_MS: "999999" }, { VOICE_MAX_CALLS: "21" }, { VOICE_LANGUAGE: "unknown" }, { VOICE_VAD_THRESHOLD: "NaN" }, { VOICE_SILENCE_MS: "0" }, { VOICE_SERVER_TOKEN: "short" }]) expect(() => serverConfig(env, [])).toThrow();
});
test("authorization checks the configured header; query strings cannot pass credentials", async () => {
  const token = "synthetic-token-for-tests";
  const request = (headers: Record<string, string> = {}, path = "/ws") => new Request(`http://localhost${path}`, { headers });
  expect(authorized(request(), token)).toBe(false);
  expect(authorized(request({ authorization: `Bearer ${token}` }), token)).toBe(true);
  expect(authorized(request({ authorization: `Bearer ${token}x` }), token)).toBe(false);
  let upgrades = 0, ready = true;
  const abort = new AbortController();
  const handlers = serverHandlers(serverConfig({ VOICE_SERVER_TOKEN: token, VOICE_MAX_CALLS: "1" }, []), {
    inference, audio: new SharedAudio(inference, abort.signal), lifetime: abort.signal,
    clinic: { async request() { throw new Error("Unexpected API request"); } }, async report() {},
  }, () => ready);
  const server = { upgrade() { upgrades++; return true; } };
  expect(handlers.fetch(request(), server)?.status).toBe(401);
  expect(handlers.fetch(request({ authorization: `Bearer ${token}` }, "/ws?token=synthetic"), server)?.status).toBe(404);
  expect(handlers.fetch(request({}, "/healthz"), server)?.status).toBe(200);
  ready = false;
  expect(handlers.fetch(request({ authorization: `Bearer ${token}` }), server)?.status).toBe(503);
  ready = true;
  expect(handlers.fetch(request({ authorization: `Bearer ${token}` }), server)).toBeUndefined();
  expect(handlers.fetch(request({ authorization: `Bearer ${token}` }), server)?.status).toBe(503);
  expect(upgrades).toBe(1);
});
test("serve help and invalid options are finite CLI commands with no runtime startup", async () => {
  for (const args of [["--help"], ["--port", "0"]]) {
    const child = Bun.spawn([process.execPath, "src/cli.ts", "serve", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [text, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (args[0] === "--help") { expect(code).toBe(0); expect(text).toContain("wss://<tunnel-host>/ws"); expect(text).not.toContain("Ready:"); }
    else { expect(code).toBe(2); expect(error).toContain("Port must be"); }
  }
});
