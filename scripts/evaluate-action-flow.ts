import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Receptionist, type ClinicReader } from "../src/voice/agent";
import { type Inference } from "../src/voice/runtime";
import { OpenRouterChat } from "../src/voice/openrouter";
import { OpenRouterConsent, consentConfig } from "../src/voice/consent-decision";
import { modelConfig, openRouterKey } from "../src/voice/model";
import { actionKey } from "../src/voice/consent";
import { stateDir } from "../src/storage";

// Real chat + Jev, synthetic read-only clinic. No runtime start, microphone, audio or submissions.
const config = modelConfig();
if (config.provider !== "openrouter") throw new Error("This finite model-flow check requires LLM_PROVIDER=openrouter; it never starts local models.");
const key = await openRouterKey(), chat = new OpenRouterChat(config, key), decisions = new OpenRouterConsent(consentConfig(), key);
let chatCalls = 0;
const inference: Inference = {
  async chat(...args) { chatCalls++; return chat.chat(...args); },
  decideConsent: (input, signal) => decisions.decide(input, signal),
  decideAction: (input, signal) => decisions.decideAction(input, signal),
  async audio() { throw new Error("Audio forbidden in this text-only check"); }, async removeAudio() {},
};
const patient = { patient_id: "P00001", given_name: "Patient", first_surname: "Example", date_of_birth: "1980-01-01", national_id: "48064716Y", insurer: "dkv" };
const provider = { id: "PR01", name: "Dr. Emilio Iglesia", specialty_id: "general_practice" };
const booking = { action: "BOOK", patient_id: "P00001", provider_id: "PR01", location_id: "centro", slot: "2026-09-22T09:00:00+02:00", appointment_type_id: "review", policy_id: "dkv" };
const clinic: ClinicReader = { async request(request) {
  if (request.method !== "GET") throw new Error("Writes forbidden");
  const path = request.path.split("?")[0];
  const data = path?.endsWith("/directory") ? { matches: [patient] }
    : path?.endsWith("/availability") ? { slots: [{ ...booking, start_time: booking.slot, provider_name: provider.name, payable_with: ["dkv"] }], blocked: [] }
    : { clinic_name: "Clínica Arenal", providers: [provider], locations: [{ id: "centro", name: "Arenal Centro" }], insurers: [{ id: "dkv", name: "DKV" }], appointment_types: [{ id: "review", name: "Revisión" }] };
  return { status: 200, elapsed_ms: 0, meaning: "OK", data };
} };
const agent = new Receptionist(inference, clinic, "2026-09-19T09:00:00+02:00", "es", event => {
  if (["action_decision", "consent", "tool", "resolution"].includes(event.stage)) console.log(JSON.stringify(event));
}, { mode: "platform" });
console.log(`Live chat (${config.model}) + Jev with synthetic clinic data; incurs OpenRouter usage.`);
let pass = false, error: string | undefined;
try {
  const initial = "Soy Patient Example, DNI 48064716Y, nacido el 1 de enero de 1980. Quiero reservar el martes 22 de septiembre de 2026 a las nueve con el doctor Emilio Iglesia en Arenal Centro, con mi seguro DKV.";
  console.log(await agent.turn(initial, AbortSignal.timeout(45000))); agent.markDelivered();
  const before = chatCalls;
  console.log(await agent.turn("Perfecto, muy bien. Confírmela, ¿queda reservada?", AbortSignal.timeout(15000)));
  pass = agent.record?.actions.length === 1 && actionKey(agent.record.actions[0]!) === actionKey(booking) && chatCalls === before;
  console.log(`Completed with ${chatCalls - before} chat calls after acceptance.`);
} catch (e) { error = e instanceof Error ? e.message : "Flow failed"; }
const path = join(stateDir, `action-flow-${Date.now()}.json`);
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await writeFile(path, JSON.stringify({ pass, error, chatCalls, record: agent.record, transcript: agent.transcript, events: agent.events }, null, 2), { mode: 0o600 });
console.log(`${pass ? "PASS" : "FAIL"}. Saved: ${path}${error ? ` (${error})` : ""}`);
if (!pass) process.exitCode = 1;
