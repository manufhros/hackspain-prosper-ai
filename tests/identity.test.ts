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
const jessica = { ...patient, patient_id: "P01971", given_name: "Jessica", first_surname: "Roberts", second_surname: "Smith", national_id: "98789619L" };

test("exact DNI tolerates one surname transcription edit and merged words, not broader identity changes", () => {
  for (const name of ["Jessica Robert Smith", "Jessica Robertsmith", "Jessica Roberts-Smith", "Jessica Smith Roberts", "Jessica Roberts Smyth"]) {
    const query = { name, national_id: jessica.national_id };
    expect(verifiedPatient(jessica, query, [`The patient is ${name}. The DNI is ${jessica.national_id}.`])).toBe(true);
  }
  for (const name of ["Jessica Robert Smyth", "Jessica Jones Smith", "Jessie Roberts Smith", "Jessica Robert", "Jessica Roberts Brown"]) {
    expect(verifiedPatient(jessica, { name, national_id: jessica.national_id }, [name, jessica.national_id])).toBe(false);
  }
  const name = "Jessica Robert Smith";
  expect(verifiedPatient(jessica, { name, national_id: "98789618L" }, [name, "98789618L"])).toBe(false);
  expect(verifiedPatient(jessica, { name, national_id: jessica.national_id }, [name])).toBe(false);
  expect(verifiedPatient(jessica, { name, phone: jessica.phone }, [name, jessica.phone])).toBe(false);
  expect(verifiedPatient(jessica, { name, national_id: jessica.national_id, date_of_birth: "1999-01-01" },
    [name, jessica.national_id, "January 1st, 1999"])).toBe(false);
});

test("directory locates by exact DNI and verifies the original spoken name locally", async () => {
  const f = fixture([tool("directory", { name: "Jessica Robert Smith", national_id: jessica.national_id }), question],
    { matches: [jessica, { ...jessica, patient_id: "different", national_id: "11111111A" }] });
  await f.agent.turn("Yes, the patient is Jessica Robert Smith. The DNI is 98789619L.", signal);
  expect(f.requests).toEqual(["/api/v1/directory?national_id=98789619L"]);
  const result = JSON.parse(f.agent.messages.find(m => m.role === "tool")!.content);
  expect(result.identity_verified).toBe(true);
  expect(result.matches.map((m: ObjectValue) => m.patient_id)).toEqual(["P01971"]);
  expect(result.matches[0]).not.toHaveProperty("national_id");
});

test("an identifier match with a larger name mismatch asks for spelling without exposing the chart", async () => {
  const f = fixture([tool("directory", { name: "Jessica Jones Smith", national_id: jessica.national_id }), question], { matches: [jessica] });
  await f.agent.turn("Jessica Jones Smith, DNI 98789619L", signal);
  const result = JSON.parse(f.agent.messages.find(m => m.role === "tool")!.content);
  expect(result.identity_verified).toBe(false); expect(result.matches).toEqual([]);
  expect(result.instruction).toContain("exact identifier matches a record");
  expect(result.instruction).toContain("spell the patient's full name");
  for (const value of ["Roberts", "P01971", jessica.phone, jessica.national_id]) expect(JSON.stringify(result)).not.toContain(value);
});

test("DNI lookup never discards conflicts or chooses between duplicate exact identifiers", async () => {
  const args = { name: "Jessica Robert Smith", national_id: jessica.national_id, date_of_birth: "1999-01-01" };
  const f = fixture([tool("directory", args), question], { matches: [jessica] });
  await f.agent.turn("Jessica Robert Smith, DNI 98789619L, born January 1st, 1999", signal);
  expect(JSON.parse(f.agent.messages.find(m => m.role === "tool")!.content).identity_verified).toBe(false);
  const ambiguous = fixture([tool("directory", { name: "Jessica Robert Smith", national_id: jessica.national_id }), question],
    { matches: [jessica, { ...jessica, patient_id: "duplicate" }] });
  await ambiguous.agent.turn("Jessica Robert Smith, DNI 98789619L", signal);
  expect(JSON.parse(ambiguous.agent.messages.find(m => m.role === "tool")!.content).identity_verified).toBe(false);
});

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
