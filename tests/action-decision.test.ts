import { expect, test } from "bun:test";
import { selectedAction } from "../src/voice/action-decision";
import { actionResult } from "./fixtures/action-decision";

test("intermediate decisions and completion use separate confidence gates; denials never authorize", () => {
  const read = { kind: "tool" as const, name: "clinic", arguments: {} };
  const complete = { ...read, name: "complete_call" };
  expect(selectedAction(actionResult("execute", 0.7), read)).toBe("execute");
  expect(selectedAction(actionResult("execute", 0.55), read)).toBe("revise");
  expect(selectedAction(actionResult("execute", 0.7), complete)).toBe("revise");
  expect(selectedAction(actionResult("execute", 0.81), complete)).toBe("execute");
  expect(selectedAction(actionResult("finish", 0.81))).toBe("revise");
  expect(selectedAction(actionResult("finish", 0.9))).toBe("finish");
  expect(selectedAction(actionResult("revise", 0.55), complete)).toBe("revise");
});

test("live approved tool fixtures satisfy the same API and outcome contracts as production", async () => {
  const { actionCases } = await import("./fixtures/action-cases");
  const { prepareRequest } = await import("../src/api");
  const { readEndpoints, toolName } = await import("../src/voice/agent");
  const { completionRecord } = await import("../src/voice/resolution");
  for (const item of actionCases) {
    const candidate = item.input.candidate;
    if (candidate?.kind !== "tool" || !item.expected.includes("execute")) continue;
    if (["offer_actions", "complete_call"].includes(candidate.name)) expect(() => completionRecord(candidate.arguments)).not.toThrow();
    else expect(() => prepareRequest(readEndpoints.find(endpoint => toolName(endpoint.path) === candidate.name)!, candidate.arguments)).not.toThrow();
  }
});
