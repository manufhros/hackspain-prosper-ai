import { type ActionChoice, type ActionDecision, type DecideAction } from "../../src/voice/action-decision";

export const actionResult = (choice: ActionChoice, probability = 0.99): ActionDecision => ({ choice, probability, confidence: 0.99, elapsed_ms: 1, model: "fake-jev" });
// Default transport/unit fixtures explicitly approve candidates. Semantic behavior
// is covered by controller regressions and the opt-in live decision evaluation.
export const allowAction: DecideAction = async () => actionResult("execute");
