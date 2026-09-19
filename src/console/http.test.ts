import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CallStore } from "./calls.ts";
import { ProviderSettings } from "./provider.ts";
import { createConsoleHandler } from "./http.ts";

class ResponseDouble extends EventEmitter {
  statusCode = 200;
  headers: Record<string, unknown> = {};
  chunks: string[] = [];
  writableLength = 0;
  headersSent = false;
  setHeader(name: string, value: unknown) {
    this.headers[name.toLowerCase()] = value;
  }
  writeHead(code: number, headers: Record<string, unknown>) {
    this.statusCode = code;
    Object.assign(this.headers, headers);
    this.headersSent = true;
  }
  write(value: string) {
    this.chunks.push(String(value));
    return true;
  }
  end(value?: string | Buffer) {
    if (value) this.chunks.push(String(value));
  }
  destroy() {
    this.emit("close");
  }
  get body() {
    return this.chunks.join("");
  }
}
function fixture() {
  const calls = new CallStore();
  const provider = new ProviderSettings(
    { read: async () => undefined, write: async () => {} },
    { apiKey: "private-test-key", agentId: "agent_test" },
  );
  return { calls, handler: createConsoleHandler(calls, provider) };
}
async function invoke(
  handler: ReturnType<typeof createConsoleHandler>,
  url: string,
  options: {
    method?: string;
    body?: unknown;
    host?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const req = Object.assign(
    Readable.from(
      options.body ? [Buffer.from(JSON.stringify(options.body))] : [],
    ),
    {
      method: options.method ?? "GET",
      url,
      headers: { host: options.host ?? "localhost:7861", ...options.headers },
      socket: { remoteAddress: "127.0.0.1" },
    },
  ) as unknown as IncomingMessage;
  const res = new ResponseDouble();
  await handler(req, res as unknown as ServerResponse);
  return res;
}

test("console serves the actual UI and locally packaged assets without a listening environment", async () => {
  const { handler } = fixture();
  const index = await invoke(handler, "/");
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /Transcripción en directo/);
  assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
  for (const asset of [
    "/styles.css",
    "/app.js",
    "/assets/lucia-orb.png",
    "/vendor/icons/Phosphor.woff2",
    "/vendor/dm-sans/dm-sans-latin-400-normal.woff2",
  ]) {
    assert.equal((await invoke(handler, asset)).statusCode, 200, asset);
  }
});

test("console never serves environment/source files or public tunnel traffic", async () => {
  const { handler } = fixture();
  for (const path of [
    "/.env",
    "/src/config.ts",
    "/%2e%2e/.env",
    "/vendor/icons/%2e%2e/selection.json",
  ]) {
    assert.equal((await invoke(handler, path)).statusCode, 404, path);
  }
  assert.equal(
    (await invoke(handler, "/", { host: "example.ngrok.app" })).statusCode,
    403,
  );
});

test("provider settings return only public metadata and reject non-console mutations", async () => {
  const { handler } = fixture();
  const read = await invoke(handler, "/api/settings");
  assert.equal(read.statusCode, 200);
  assert.ok(!read.body.includes("private-test-key"));
  const forbidden = await invoke(handler, "/api/settings", {
    method: "POST",
    body: { agentId: "agent_other" },
  });
  assert.equal(forbidden.statusCode, 403);
  const saved = await invoke(handler, "/api/settings", {
    method: "POST",
    body: { agentId: "agent_other", apiKey: "" },
    headers: { "content-type": "application/json", "x-lucia-console": "1" },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(JSON.parse(saved.body).agentId, "agent_other");
  assert.ok(!saved.body.includes("private-test-key"));
});

test("event stream supplies an initial snapshot, updates and releases subscriptions", async () => {
  const { calls, handler } = fixture();
  const response = await invoke(handler, "/api/events");
  try {
    assert.match(response.body, /event: snapshot/);
    calls.start("call-live");
    calls.message("call-live", "user", "Hola");
    assert.match(response.body, /event: call/);
    assert.match(response.body, /"messages":1/);
    const detail = await invoke(handler, "/api/calls/call-live");
    assert.equal(JSON.parse(detail.body).transcript[0].text, "Hola");
    assert.equal(calls.listenerCount("change"), 1);
  } finally {
    response.emit("close");
  }
  assert.equal(calls.listenerCount("change"), 0);
});
