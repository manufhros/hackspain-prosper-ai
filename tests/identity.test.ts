import { expect, test } from "bun:test";
import { callerSupplied, verifiedPatient } from "../src/voice/identity";
import { Receptionist, type ClinicReader } from "../src/voice/agent";
import { type Inference, type Message } from "../src/voice/runtime";
import { type ObjectValue } from "../src/data";

const patient = { patient_id: "P1", given_name: "Josefa", first_surname: "Domínguez", second_surname: "Navarro", date_of_birth: "2001-09-19", phone: "636308034", national_id: "48064716Y", insurer: "mapfre" };
const tool = (name: string, args: ObjectValue): Message => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
function fixture(replies: Message[], data: ObjectValue, callerPhone?: string) {
  const requests: string[] = [];
  const inference: Inference = { async chat() { return { elapsed_ms: 0, message: replies.shift()! }; }, async audio() { throw new Error("Unexpected audio"); }, async removeAudio() {} };
  const clinic: ClinicReader = { async request(request) { requests.push(request.path); return { status: 200, elapsed_ms: 0, meaning: "OK", data }; } };
  const agent = new Receptionist(inference, clinic, "2026-09-18T09:00:00+02:00", "en", () => {}, { callerPhone });
  return { agent, requests };
}
const question: Message = { role: "assistant", content: "Please tell me your full name and date of birth." };
const signal = new AbortController().signal;

test("identity requires supplied name and exact matching second field, not a caller-ID hint", () => {
  const turns = ["Me llamo Josefa Domínguez", "Nací el 19 de septiembre de 2001"];
  expect(verifiedPatient(patient, { name: "Josefa Domínguez", date_of_birth: "2001-09-19" }, turns)).toBe(true);
  expect(verifiedPatient(patient, { name: "Josefa Domínguez", phone: patient.phone }, turns)).toBe(false);
  expect(verifiedPatient(patient, { name: "Paco Mer", phone: patient.phone }, ["Paco Mer", patient.phone])).toBe(false);
  expect(verifiedPatient(patient, { name: "Josefa Domínguez", date_of_birth: "2005-09-25" }, [turns[0]!, "25 de septiembre de 2005"])).toBe(false);
  expect(callerSupplied("date_of_birth", "2001-09-19", ["September 19th, 2001"])).toBe(true);
  expect(callerSupplied("date_of_birth", "2001-09-19", ["19 de setembre de 2001"])).toBe(true);
  expect(callerSupplied("date_of_birth", "2001-02-01", ["01/02/2001"])).toBe(false);
  expect(callerSupplied("national_id", "48064716Y", ["My DNI is 48,064,716 Y"])).toBe(true);
  expect(callerSupplied("phone", "636308034", ["My phone is +34 636 308 034"])).toBe(true);
  expect(callerSupplied("phone", "636308034", ["0034 636 308 034"])).toBe(true);
  expect(callerSupplied("phone", "636308034", ["6363080345"])).toBe(false);
});

test("carrier lookup cannot expose name, insurance or identifiers or unlock appointments", async () => {
  const f = fixture([tool("directory", { phone: "+34636308034" }), tool("appointments", { patient_id: "P1" }), question], { matches: [patient] }, "+34636308034");
  await f.agent.turn("Hello", signal);
  expect(f.requests).toHaveLength(1);
  const results = f.agent.messages.filter(m => m.role === "tool").map(m => m.content).join("\n");
  expect(results).toContain('"identity_verified":false');
  for (const value of ["Josefa", "mapfre", patient.phone, patient.national_id, "P1"]) expect(results).not.toContain(value);
  expect(results).toContain("Verify the patient");
});

test("verified directory exposes chart context but omits protected identifiers", async () => {
  const f = fixture([tool("directory", { name: "Josefa Domínguez", date_of_birth: "2001-09-19" }), question], { matches: [patient] });
  await f.agent.turn("My name is Josefa Domínguez, born September 19th, 2001", signal);
  const result = JSON.parse(f.agent.messages.find(m => m.role === "tool")!.content);
  expect(result.identity_verified).toBe(true);
  expect(result.matches[0].patient_id).toBe("P1");
  for (const key of ["phone", "national_id", "date_of_birth"]) expect(result.matches[0]).not.toHaveProperty(key);
});

test("invented identity arguments never reach the clinic", async () => {
  const f = fixture([tool("directory", { name: "Josefa Domínguez", phone: patient.phone }), question], { matches: [patient] });
  await f.agent.turn("Hello", signal);
  expect(f.requests).toHaveLength(0);
});
