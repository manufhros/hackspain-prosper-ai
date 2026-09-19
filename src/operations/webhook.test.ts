import test from "node:test";
import assert from "node:assert/strict";
import { verifyPhoneWebhook } from "./webhook.ts";

test("public preflight retries a transient timeout without calling Twilio", async t => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    assert.equal(url, "https://voice.example/check");
    if (++attempts === 1) throw new DOMException("timeout", "TimeoutError");
    return new Response('<Response><Say language="es-ES">Prueba</Say></Response>', { headers: { "x-operations-call-id": "call-1" } });
  });
  await verifyPhoneWebhook("https://voice.example/check", "call-1", new AbortController().signal);
  assert.equal(attempts, 2);
});
test("preflight names the tunnel error and stops after two attempts", async t => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; throw new Error("network"); });
  await assert.rejects(verifyPhoneWebhook("https://voice.example/check", "call-1", new AbortController().signal), /Ngrok.*No se ha solicitado/);
  assert.equal(attempts, 2);
});
test("preflight does not retry a wrong server", async t => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; return new Response("Wrong server"); });
  await assert.rejects(verifyPhoneWebhook("https://voice.example/check", "call-1", new AbortController().signal), /instrucciones/);
  assert.equal(attempts, 1);
});
