import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenRouterConsent, consentConfig } from "../src/voice/consent-decision";
import { openRouterKey } from "../src/voice/model";
import { stateDir } from "../src/storage";
import { actionCases } from "../tests/fixtures/action-cases";
import { selectedAction } from "../src/voice/action-decision";

// Finite, opt-in model evaluation: synthetic text only, no servers, audio, clinic calls or submissions.
const config = consentConfig(), model = new OpenRouterConsent(config, await openRouterKey());
const results: unknown[] = [];
let failures = 0;
console.log(`Evaluating ${actionCases.length} action decisions with ${config.model}; incurs OpenRouter usage.`);
for (let offset = 0; offset < actionCases.length; offset += 4) {
  await Promise.all(actionCases.slice(offset, offset + 4).map(async item => {
    try {
      const decision = await model.decideAction(item.input, AbortSignal.timeout(config.timeoutMs + 1000));
      const selected = selectedAction(decision, item.input.candidate);
      const pass = item.expected.includes(selected);
      if (!pass) failures++;
      const result = { id: item.id, pass, selected, decision }; results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      failures++; const result = { id: item.id, pass: false, error: error instanceof Error ? error.message : "Decision failed" };
      results.push(result); console.log(JSON.stringify(result));
    }
  }));
}
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const path = join(stateDir, `action-evaluation-${Date.now()}.json`);
await writeFile(path, JSON.stringify({ model: config.model, results }, null, 2), { mode: 0o600 });
console.log(`${actionCases.length - failures}/${actionCases.length} passed. Saved: ${path}`);
if (failures) process.exitCode = 1;
