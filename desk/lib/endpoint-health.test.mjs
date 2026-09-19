import test from "node:test";
import assert from "node:assert/strict";
import { checkEndpointHealth, safeEndpoint } from "./endpoint-health.ts";

function mockRequests(t, { address = "108.133.183.8", status = 200, dnsStatus = 0 } = {}) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    requests.push(url);
    assert.equal(init.redirect, "manual", "Workers does not support redirect:error");
    assert.equal(init.cache, "no-store");
    if (url.hostname === "cloudflare-dns.com") {
      const type = Number(url.searchParams.get("type"));
      return Response.json({ Status: dnsStatus, Answer: type === 1 ? [{ type: 5, data: "alias.example.com" }, { type, data: address }] : [] });
    }
    return new Response(null, { status });
  });
  return requests;
}

test("all Prosper integration URLs probe health using Workers-compatible fetch", async (t) => {
  const requests = mockRequests(t);
  for (const path of ["directory", "availability", "submissions"]) {
    const result = await checkEndpointHealth(`https://hackspain.getprosperapp.com/api/v1/${path}`);
    assert.equal(result.status, "healthy");
    assert.equal(result.statusCode, 200);
  }
  assert.deepEqual(requests.filter(url => url.hostname !== "cloudflare-dns.com").map(String),
    Array(3).fill("https://hackspain.getprosperapp.com/api/v1/health"));
});

test("private DNS answers never trigger an endpoint request", async (t) => {
  const requests = mockRequests(t, { address: "10.0.0.1" });
  const result = await checkEndpointHealth("https://private.example.com/hook");
  assert.equal(result.status, "down");
  assert.match(result.message, /red privada/);
  assert.equal(requests.length, 2);
});

test("DNS failures are reported as DNS failures, not private addresses", async (t) => {
  mockRequests(t, { dnsStatus: 3 });
  const result = await checkEndpointHealth("https://missing.example.com/hook");
  assert.equal(result.statusCode, null);
  assert.match(result.message, /resolver el dominio/);
});

test("unsafe schemes, credentials and private IP literals are rejected", async () => {
  for (const url of ["http://example.com", "https://user:pass@example.com", "https://127.0.0.1", "https://169.254.169.254", "https://[::1]", "https://[::ffff:127.0.0.1]"]) {
    await assert.rejects(safeEndpoint(url));
  }
});

for (const [status, expected] of [[302, "degraded"], [401, "degraded"], [503, "down"]]) {
  test(`HTTP ${status} is ${expected} and redirects are not followed`, async (t) => {
    const requests = mockRequests(t, { status });
    const result = await checkEndpointHealth("https://example.com/hook");
    assert.equal(result.status, expected);
    assert.equal(result.statusCode, status);
    assert.equal(requests.length, 3);
    assert.equal(String(requests.at(-1)), "https://example.com/hook");
  });
}

test("unconfigured endpoints remain unknown without issuing requests", async (t) => {
  const requests = mockRequests(t);
  assert.equal((await checkEndpointHealth("  ")).status, "unknown");
  assert.equal(requests.length, 0);
});

test("network failures remain down", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Connection timed out"); });
  const result = await checkEndpointHealth("https://example.com/hook");
  assert.equal(result.status, "down");
  assert.match(result.message, /timed out/);
});
