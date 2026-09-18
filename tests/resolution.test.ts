import { expect, test } from "bun:test";
import { cases, operations, type Outcome } from "../src/data";
import { agentTools } from "../src/voice/agent";
import { completionRecord, simulatedSubmission } from "../src/voice/resolution";
import { validate } from "../src/validation";

const record: Outcome = { actions: [{ action: "NO_ACTION", reason: "out_of_scope" }] };
test("completion accepts direct actions and legacy envelopes without changing action values", () => {
  for (const args of [record, { record }, { record: JSON.stringify(record) }, { record: record.actions }, record.actions[0]]) {
    expect(completionRecord(args)).toEqual(record);
  }
  const copied = completionRecord(record); copied.actions[0]!.reason = "provider_not_found";
  expect(record.actions[0]!.reason).toBe("out_of_scope");
});
test("completion never fills missing action fields or silently drops extra/conflicting data", () => {
  for (const args of [{}, { record: {} }, { actions: [] }, { action: "BOOK" }, { actions: [{ reason: "out_of_scope" }] },
    { record, actions: [{ action: "ESCALATE", reason: "medical_emergency" }] }, { ...record, surprise: true },
    { actions: [{ action: "NO_ACTION", reason: "made_up" }] }]) expect(() => completionRecord(args)).toThrow();
});
test("advertised completion schema requires top-level actions and explicit action verbs", () => {
  const parameters = agentTools.find(t => t.function.name === "complete_call")!.function.parameters;
  expect(parameters.required).toEqual(["actions"]);
  expect(parameters.properties).not.toHaveProperty("record");
  expect(validate({ actions: [{ reason: "out_of_scope" }] }, parameters)).not.toHaveLength(0);
  // These are schema fixtures, never agent outcomes or live scheduling evidence.
  for (const item of cases) for (const outcome of item.expected.acceptable) expect(validate(outcome, parameters)).toEqual([]);
});
test("mock submissions follow all six track routes and flatten REGISTER only on the wire", () => {
  const outcomes = cases.flatMap(c => c.expected.acceptable);
  const actions = [...new Map(outcomes.flatMap(r => r.actions).map(action => [action.action, action])).values()];
  expect(actions).toHaveLength(6);
  const mock = simulatedSubmission({ actions });
  expect(mock.record).toEqual({ actions });
  expect(mock.accepted_locally).toBe(true); expect(mock.platform_submission).toBe(false);
  expect(mock.submission_preview).toHaveLength(6);
  for (const request of mock.submission_preview) {
    expect(request.method).toBe("POST"); expect(request.body.call_id).toBe("<start.callSid>");
    const endpoint = operations.find(e => e.path === request.path)!;
    expect(validate(request.body, endpoint.requestBody!.content["application/json"].schema)).toEqual([]);
    expect(request.body).not.toHaveProperty("action"); expect(request.body).not.toHaveProperty("new_patient");
  }
});
