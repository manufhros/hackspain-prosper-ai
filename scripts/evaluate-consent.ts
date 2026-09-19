import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenRouterConsent, consentConfig } from "../src/voice/consent-decision";
import { Consent } from "../src/voice/consent";
import { openRouterKey } from "../src/voice/model";
import { stateDir } from "../src/storage";
import { consentBooking, consentOffer, consentCases } from "../tests/fixtures/consent-cases";

// Explicit opt-in: finite remote text decisions only. No servers, audio, clinic access or submissions.
const config = consentConfig();
const model = new OpenRouterConsent(config, await openRouterKey());
console.log(`Evaluating ${consentCases.length} synthetic consent cases with ${config.model}; incurs OpenRouter usage.`);
const results: { id: string; pass: boolean; accepted: boolean; decision?: unknown; error?: string; elapsed_ms: number }[] = [];
for (let index = 0; index < consentCases.length; index += 4) {
  await Promise.all(consentCases.slice(index, index + 4).map(async item => {
    const consent = new Consent();
    const speech = item.cancel ? "Cancelar la cita con Dr. Emilio Iglesia en Arenal Centro, martes 22 de septiembre de 2026, 09:00. ¿Quiere que cancele esta cita?" : consentOffer;
    const action = item.cancel ? { action: "CANCEL", appointment_id: "synthetic-appointment" } : consentBooking;
    consent.offer([action], item.delivered ?? true, "Dr. Emilio Iglesia", "Arenal Centro", speech);
    const started = performance.now();
    let decision: unknown, error: string | undefined;
    try {
      decision = await consent.hear(item.reply, [{ role: "agent", text: speech },
        ...(item.lastQuestion ? [{ role: "agent" as const, text: item.lastQuestion }] : []), { role: "caller", text: item.reply }],
        (input, signal) => model.decide(input, signal), AbortSignal.timeout(config.timeoutMs + 1000));
    } catch (e) { error = e instanceof Error ? e.message : "Evaluation failed"; }
    const accepted = consent.hasAccepted([action]);
    const result = { id: item.id, pass: !error && accepted === item.accept, accepted, decision, error, elapsed_ms: Math.round(performance.now() - started) };
    results.push(result); console.log(JSON.stringify(result));
  }));
}
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const path = join(stateDir, `consent-evaluation-${Date.now()}.json`);
await writeFile(path, JSON.stringify({ model: config.model, results }, null, 2), { mode: 0o600 });
console.log(`${results.filter(r => r.pass).length}/${results.length} passed. Saved: ${path}`);
if (results.some(r => !r.pass)) process.exitCode = 1;
