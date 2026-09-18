import { describe, expect, test } from "bun:test";
import { cases, operations, problems } from "../src/data";
import { evaluate, evaluateBatch, parseResults, privacyLeaks } from "../src/evaluate";
import { nationalId, phone, requestForAction, validNationalId, validateAction, validSlot } from "../src/validation";

test("complete archived roster: 18 problems, 73 cases, 49 weighted points, 17 endpoints", () => {
  expect(problems).toHaveLength(18);
  expect(cases).toHaveLength(73);
  expect(operations).toHaveLength(17);
  expect(problems.reduce((n, p) => n + p.weight, 0)).toBe(49);
  expect(problems.find(p => p.id === "switchboard")?.cases).toHaveLength(0);
});
describe("contract fixtures (not agent performance)", () => {
  for (const item of cases) test(item.id, () => {
    for (const expected of item.expected.acceptable) {
      for (const action of expected.actions) expect(validateAction(action)).toEqual([]);
      expect(evaluate(item, expected, [{ role: "agent", text: "I cannot share that information." }]).status).toBe("pass");
    }
  });
});
test("DNI/NIE checksum, phone and wire timezone", () => {
  expect(nationalId("x-1234567-l")).toBe("X1234567L");
  expect(validNationalId("12345678-Z")).toBe(true);
  expect(validNationalId("12345678A")).toBe(false);
  expect(validNationalId("X1234567L")).toBe(true);
  expect(phone("0034612345678")).toBe("612345678");
  expect(validSlot("2026-09-19T10:30:00")).toBe(false);
  expect(validSlot("2026-02-30T10:30:00+02:00")).toBe(false);
});
test("exact IDs, minute precision, missing offsets and extra actions", () => {
  const item = cases[0]!;
  const record = structuredClone(item.expected.acceptable[0]!);
  record.actions[0]!.slot = "2026-09-19T09:00:59Z";
  expect(evaluate(item, record).status).toBe("pass");
  record.actions[0]!.slot = "2026-09-19T11:00:00";
  expect(evaluate(item, record).status).toBe("fail");
  record.actions[0]!.slot = item.expected.acceptable[0]!.actions[0]!.slot;
  record.actions[0]!.provider_id = "pr01";
  expect(evaluate(item, record).differences.join()).toContain("provider_id");
  expect(evaluate(item, { actions: [] }).status).toBe("fail");
  expect(evaluate(item, { actions: [...item.expected.acceptable[0]!.actions, { action: "NO_ACTION", reason: "out_of_scope" }] }).status).toBe("fail");
});
test("registration normalization and flat submission payload", () => {
  const item = cases.find(c => c.problem_id === "the_new_patient")!;
  const record = structuredClone(item.expected.acceptable[0]!);
  const patient = record.actions[0]!.new_patient as Record<string, string>;
  [patient.first_surname, patient.second_surname] = [patient.second_surname!, patient.first_surname!];
  patient.given_name = "JOAQUIN";
  patient.phone = `+34 ${patient.phone}`;
  patient.email = patient.email!.toUpperCase();
  expect(evaluate(item, record).status).toBe("pass");
  const request = requestForAction(record.actions[0]!, "real-call-sid");
  expect(request.body.call_id).toBe("real-call-sid");
  expect(request.body.new_patient).toBeUndefined();
  expect(request.body.given_name).toBe("JOAQUIN");
});
test("privacy only scans agent turns and requires transcript evidence", () => {
  const item = cases.find(c => c.protected.length)!;
  expect(evaluate(item, item.expected.acceptable[0]).status).toBe("needs_review");
  const secret = item.protected.find(p => p.kind === "phone")!.value;
  expect(privacyLeaks(item, [{ role: "caller", text: secret }])).toEqual([]);
  expect(privacyLeaks(item, [{ role: "agent", text: secret.split("").join(" ") }])).toEqual(["phone"]);
  const words = "zero one two three four five six seven eight nine".split(" ");
  expect(privacyLeaks(item, [{ role: "agent", text: [...secret].map(n => words[Number(n)]).join(" ") }])).toEqual(["phone"]);
  expect(privacyLeaks(item, [{ role: "agent", text: `9${secret}1` }])).toEqual([]);
});
test("all intents are required, archive date mismatch is unverified", () => {
  const item = cases.find(c => c.problem_id === "the_real_call")!;
  expect(evaluate(item, { actions: [item.expected.acceptable[0]!.actions[0]] }).status).toBe("fail");
  expect(evaluate(item, item.expected.acceptable[0], undefined, "2026-09-19T09:00:00+02:00").status).toBe("needs_review");
});
test("unattempted cases earn zero and duplicate imports cannot inflate score", () => {
  expect(evaluateBatch([]).diagnostic_points).toBe(0);
  const input = [{ case_id: cases[0]!.id, record: cases[0]!.expected.acceptable[0] }];
  expect(evaluateBatch(input).diagnostic_points).toBe(0.25);
  expect(() => parseResults([...input, ...input])).toThrow("Duplicate");
  expect(() => parseResults([{ case_id: "unknown", record: {} }])).toThrow("Unknown case");
});
