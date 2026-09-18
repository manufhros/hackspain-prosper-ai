import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseUrl, PlatformClient, prepareRequest } from "../src/api";
import { cases, operations } from "../src/data";
import { CallSession, inspectTrace, wireMessages } from "../src/protocol";
import { saveLocal } from "../src/storage";

test("API form encodes plus signs, path IDs and repeated insurers", () => {
  const directory = operations.find(o => o.path.endsWith("/directory"))!;
  expect(prepareRequest(directory, { phone: "+34612345678" }).path).toContain("phone=%2B34612345678");
  const availability = operations.find(o => o.path.endsWith("/availability"))!;
  const fields = { date_from: "2026-09-21", date_to: "2026-09-25", specialty_id: "dermatology", insurer: ["sanitas", "cigna"] };
  expect(prepareRequest(availability, fields).path).toContain("insurer=sanitas&insurer=cigna");
  expect(() => prepareRequest(availability, { ...fields, date_to: "2026-10-16" })).toThrow("14 days");
  expect(() => prepareRequest(directory, {})).toThrow("identifier");
  const appointments = operations.find(o => o.path.endsWith("/appointments"))!;
  expect(prepareRequest(appointments, { patient_id: "P/a" }).path).toContain("P%2Fa");
});
test("client sends the right contract, never follows redirects or leaks key", async () => {
  let observed: RequestInit | undefined;
  const fake = async (_url: unknown, init?: RequestInit) => { observed = init; return new Response('{"detail":"test-secret"}', { status: 403 }); };
  const client = new PlatformClient("https://example.test", "test-secret", fake);
  const response = await client.request({ method: "GET", path: "/api/v1/clinic" });
  expect(observed?.redirect).toBe("error");
  expect(observed?.headers).toMatchObject({ "X-Api-Key": "test-secret" });
  expect(JSON.stringify(response)).not.toContain("test-secret");
  expect(response.status).toBe(403);
  expect(response.meaning).toContain("revoked");
  await expect(client.request({ method: "GET", path: "https://elsewhere.test/api/v1/clinic" })).rejects.toThrow("outside");
  expect(() => baseUrl("https://user:password@example.test")).toThrow();
  expect(() => baseUrl("http://example.test")).toThrow();
});
test("request failures and 409/410 are visible, not silently retried", async () => {
  let sends = 0;
  const fake = async () => { sends++; return new Response("{}", { status: 410 }); };
  const client = new PlatformClient("http://localhost:1234", "test-key", fake);
  expect((await client.request({ method: "POST", path: "/api/v1/submit/cancel", body: { call_id: "c", appointment_id: "a" } })).meaning).toContain("expired");
  expect(sends).toBe(1);
  await expect(new PlatformClient("https://example.test", null, fake).request({ method: "GET", path: "/api/v1/clinic" })).rejects.toThrow("API key");
});
test("submission window, wrong calls, duplicate actions and 20 isolated sessions", async () => {
  const sessions = Array.from({ length: 20 }, (_, i) => new CallSession(`call-${i}`));
  await Promise.all(sessions.map(async (session, i) => {
    await Promise.resolve();
    const action = { action: "CANCEL", appointment_id: `A${i}` };
    expect(session.submit("wrong-id", action, 0)).toBe(404);
    expect(session.submit(session.callId, action, 0)).toBe(200);
    expect(session.submit(session.callId, { appointment_id: `A${i}`, action: "CANCEL" }, 1)).toBe(409);
    session.close(1000);
    expect(session.submit(session.callId, { action: "NO_ACTION", reason: "out_of_scope" }, 31000)).toBe(200);
    expect(session.submit(session.callId, action, 31001)).toBe(410);
    expect(session.record.actions[0]!.appointment_id).toBe(`A${i}`);
  }));
  expect(sessions[0]!.submit("call-0", { action: "INVALID" }, 50000)).toBe(410);
  expect(new CallSession("x").submit("x", { action: "INVALID" }, 0)).toBe(422);
  expect(new CallSession("x").submit("x", cases[0]!.expected.acceptable[0]!.actions[0]!, 0)).toBe(200);
});
test("Twilio contract accepts interleaved connections and detects stream/id/type mistakes", () => {
  const a = wireMessages("call-a", "stream-a"), b = wireMessages("call-b", "stream-b");
  const trace = [
    { connection: "a", message: a.connected }, { connection: "b", message: b.connected },
    { connection: "a", message: a.start }, { connection: "b", message: b.start },
    { connection: "a", message: a.media(0) }, { connection: "b", message: b.media(0) },
    { connection: "a", message: a.stop(1) }, { connection: "b", message: b.stop(1) },
  ];
  expect(inspectTrace(trace).valid).toBe(true);
  const broken = structuredClone(trace);
  broken[4]!.message = b.media(0);
  expect(inspectTrace(broken).calls[0]!.errors).toContain("Cross-call streamSid mismatch");
  expect(inspectTrace([{ connection: "a", message: { ...a.start, sequenceNumber: 1 } }]).valid).toBe(false);
  expect(inspectTrace([]).valid).toBe(false);
});
test("local reports use private permissions and atomic complete writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "el-turno-test-"));
  try {
    const path = await saveLocal("result.json", { okay: true }, dir);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ okay: true });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(saveLocal("../escape.json", {}, dir)).rejects.toThrow("artifact");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
