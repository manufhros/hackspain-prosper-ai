import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallStore } from "./calls.ts";
import { ProviderSettings } from "./provider.ts";
import { isLocalConsoleRequest } from "./http.ts";
import type { IncomingMessage } from "node:http";

test("call transcript correction, tool results and statuses stay isolated across simultaneous calls", () => {
  const calls = new CallStore();
  calls.start("a");
  calls.start("b");
  calls.connected("a");
  calls.message("a", "agent", "Una respuesta demasiado larga");
  calls.message("b", "user", "Otra llamada");
  calls.correct("a", "Una respuesta demasiado larga", "Una respuesta");
  calls.toolStart("a", "t", "search_directory", {
    name: "Elena",
    api_key: "never-store",
  });
  calls.toolStart("a", "t", "search_directory", {});
  calls.toolEnd(
    "a",
    "t",
    JSON.stringify({
      matches: [{ given_name: "Elena", first_surname: "Martín" }],
    }),
  );
  calls.finish("a");
  calls.finish("b");
  assert.equal(calls.get("a")?.transcript[0]?.text, "Una respuesta");
  assert.equal(calls.get("a")?.tools.length, 1);
  assert.equal(calls.get("a")?.name, "Elena Martín");
  assert.equal(calls.get("a")?.status, "completed");
  assert.equal(calls.get("b")?.status, "missed");
  assert.equal(calls.get("b")?.transcript[0]?.text, "Otra llamada");
  assert.ok(!JSON.stringify(calls.get("a")).includes("never-store"));
});

test("tool application errors are failures even when the transport succeeds", () => {
  const calls = new CallStore();
  calls.start("a");
  calls.toolStart("a", "t", "submit_book", {});
  calls.toolEnd("a", "t", '{"error":"missing book fields"}');
  assert.equal(calls.get("a")?.tools[0]?.status, "failed");
  calls.fail("a", "Proveedor desconectado");
  calls.finish("a");
  assert.equal(calls.get("a")?.status, "failed");
});

test("history persists and a restart does not show interrupted calls as live", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lucia-test-"));
  try {
    const path = join(directory, "calls.json");
    const calls = new CallStore(path);
    calls.start("active");
    calls.toolStart("active", "tool", "search_availability", {});
    await calls.flush();
    const reloaded = new CallStore(path);
    await reloaded.load();
    assert.equal(reloaded.get("active")?.status, "interrupted");
    assert.equal(reloaded.get("active")?.tools[0]?.status, "interrupted");
    assert.equal(JSON.parse(await readFile(path, "utf8")).length, 1);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("console rejects tunnel hosts, foreign origins and non-loopback clients", () => {
  const request = (
    host: string,
    remoteAddress = "127.0.0.1",
    origin?: string,
  ) =>
    ({
      headers: { host, ...(origin ? { origin } : {}) },
      socket: { remoteAddress },
    }) as IncomingMessage;
  assert.equal(isLocalConsoleRequest(request("localhost:7860")), true);
  assert.equal(
    isLocalConsoleRequest(
      request("127.0.0.1:7860", "127.0.0.1", "http://127.0.0.1:7860"),
    ),
    true,
  );
  assert.equal(isLocalConsoleRequest(request("public.ngrok.app")), false);
  assert.equal(
    isLocalConsoleRequest(request("localhost:7860", "192.168.1.2")),
    false,
  );
  assert.equal(
    isLocalConsoleRequest(
      request("localhost:7860", "127.0.0.1", "https://attacker.test"),
    ),
    false,
  );
});

test("provider save is atomic on vault failure and never returns the secret", async () => {
  const initial = { apiKey: "test-original", agentId: "agent_original" };
  const settings = new ProviderSettings(
    {
      read: async () => undefined,
      write: async () => {
        throw new Error("vault unavailable");
      },
    },
    initial,
  );
  await assert.rejects(
    settings.save({ apiKey: "test-new", agentId: "agent_new" }),
  );
  assert.deepEqual(settings.get(), initial);
  assert.ok(!JSON.stringify(settings.public()).includes("test-original"));
});

test("provider preserves a masked existing key, persists and tests unsaved credentials without mutation", async () => {
  let saved = "";
  const settings = new ProviderSettings(
    {
      read: async () => saved,
      write: async (value) => {
        saved = value;
      },
    },
    { apiKey: "test-secret", agentId: "agent_old" },
  );
  await settings.save({ apiKey: "", agentId: "agent_new" });
  assert.equal(JSON.parse(saved).apiKey, "test-secret");
  const request = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    assert.ok(String(url).endsWith("/agent_draft"));
    assert.equal(
      (options?.headers as Record<string, string>)["xi-api-key"],
      "test-draft",
    );
    return new Response('{"name":"Lucía"}', { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(
    await settings.test(
      { agentId: "agent_draft", apiKey: "test-draft" },
      request,
    ),
    { name: "Lucía" },
  );
  assert.equal(settings.get().agentId, "agent_new");
  assert.equal(settings.get().apiKey, "test-secret");
});
