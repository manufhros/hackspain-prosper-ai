import { type ActionInput, type ActionChoice, type ActionCandidate } from "../../src/voice/action-decision";
import { agentTools } from "../../src/voice/agent";
import { consentBooking, consentOffer } from "./consent-cases";

const booking: typeof consentBooking = { ...consentBooking, patient_id: "P00001", provider_id: "PR01" };
const cancel = { action: "CANCEL", appointment_id: "A-future" };
const evidence = [
  { tool: "directory", result: JSON.stringify({ identity_verified: true, matches: [{ patient_id: booking.patient_id, given_name: "Test", first_surname: "Example" }] }) },
  { tool: "availability", result: JSON.stringify({ slots: [{ patient_id: booking.patient_id, provider_id: booking.provider_id, provider_name: "Dr. Emilio Iglesia", location_id: "centro", start_time: booking.slot, appointment_type_id: "review", payable_with: ["dkv"] }] }) },
  { tool: "appointments", result: JSON.stringify({ appointments: [{ appointment_id: "A-future", patient_id: booking.patient_id, provider_id: booking.provider_id, location_id: "centro", start_time: "2026-09-25T09:00:00+02:00" }] }) },
];
const base: ActionInput = { conversation: [{ role: "caller", text: "Soy Test Example. Quiero reservar con Emilio Iglesia en Arenal Centro, el martes 22 de septiembre a las nueve, con DKV." }],
  accepted: [], evidence, reference_time: "2026-09-19T09:00:00+02:00" };
const tool = (name: string, args: Record<string, unknown>): ActionCandidate => ({ kind: "tool", name, arguments: args });
export const actionCases: { id: string; input: ActionInput; expected: ActionChoice[] }[] = [
  { id: "read-clinic", input: { ...base, evidence: [], conversation: [{ role: "caller", text: "¿A qué hora abren?" }], candidate: tool("clinic", {}) }, expected: ["execute"] },
  { id: "read-directory", input: { ...base, evidence: [], conversation: [{ role: "caller", text: "Quiero pedir cita. Soy Test Example, DNI 48064716Y." }], candidate: tool("directory", { name: "Test Example", national_id: "48064716Y" }) }, expected: ["execute"] },
  { id: "read-availability", input: { ...base, evidence: [...evidence.slice(0, 1), { tool: "providers", result: JSON.stringify({ providers: [{ id: booking.provider_id, name: "Dr. Emilio Iglesia" }], locations: [{ id: "centro", name: "Arenal Centro" }] }) }], candidate: tool("availability", { patient_id: booking.patient_id, provider_id: booking.provider_id, location_id: "centro", insurer: ["dkv"], date_from: "2026-09-22", date_to: "2026-09-22" }) }, expected: ["execute"] },
  { id: "read-appointments", input: { ...base, conversation: [{ role: "caller", text: "Quiero cancelar mi cita existente." }], evidence: evidence.slice(0, 1), candidate: tool("appointments", { patient_id: booking.patient_id }) }, expected: ["execute"] },
  { id: "offer-book", input: { ...base, candidate: tool("offer_actions", { actions: [booking] }) }, expected: ["execute"] },
  { id: "offer-cancel", input: { ...base, conversation: [{ role: "caller", text: "Quiero cancelar la cita del viernes 25 de septiembre." }], candidate: tool("offer_actions", { actions: [cancel] }) }, expected: ["execute"] },
  { id: "offer-reschedule", input: { ...base, conversation: [{ role: "caller", text: "Mueva mi cita del viernes 25 al martes 22 a las nueve, mismo doctor Emilio Iglesia y centro, con DKV." }], candidate: tool("offer_actions", { actions: [{ action: "RESCHEDULE", appointment_id: "A-future", provider_id: booking.provider_id, location_id: "centro", slot: booking.slot, policy_id: "dkv" }] }) }, expected: ["execute"] },
  { id: "offer-register", input: { ...base, evidence: [{ tool: "directory", result: '{"matches":[]}' }], conversation: [{ role: "caller", text: "No soy paciente todavía. Quiero darme de alta como Test Example Demo, nacido el 1 de enero de 1980, DNI 48064716Y, teléfono 636308034, correo test@example.com y seguro DKV." }], candidate: tool("offer_actions", { actions: [{ action: "REGISTER", new_patient: { given_name: "Test", first_surname: "Example", second_surname: "Demo", email: "test@example.com", insurer: "dkv", date_of_birth: "1980-01-01", national_id: "48064716Y", phone: "636308034" } }] }) }, expected: ["execute"] },
  { id: "no-action", input: { ...base, evidence: [], conversation: [{ role: "caller", text: "Can you fix my bicycle? No, I don't need anything from the clinic." }], candidate: tool("complete_call", { actions: [{ action: "NO_ACTION", reason: "out_of_scope" }] }) }, expected: ["execute"] },
  { id: "emergency", input: { ...base, evidence: [], conversation: [{ role: "caller", text: "Tengo una opresión en el pecho y me falta el aire." }], candidate: tool("complete_call", { actions: [{ action: "ESCALATE", reason: "medical_emergency" }] }) }, expected: ["execute"] },
  { id: "emergency-not-identity", input: { ...base, evidence: [], conversation: [{ role: "caller", text: "Tengo una opresión en el pecho y me falta el aire." }], candidate: { kind: "speech", text: "¿Me da su nombre y DNI para buscar una cita?" } }, expected: ["revise"] },
  { id: "premature-success-speech", input: { ...base, candidate: { kind: "speech", text: "Su cita ya está confirmada." } }, expected: ["revise"] },
  { id: "wrong-action", input: { ...base, candidate: tool("offer_actions", { actions: [cancel] }) }, expected: ["revise"] },
  { id: "invented-identity", input: { ...base, evidence: [], conversation: [{ role: "caller", text: "Quiero una cita." }], candidate: tool("directory", { name: "Invented Name", national_id: "48064716Y" }) }, expected: ["revise", "clarify"] },
  { id: "grounded-information", input: { ...base, conversation: [{ role: "caller", text: "¿A qué hora abre la clínica?" }], evidence: [{ tool: "clinic", result: '{"opening_hours":"09:00"}' }], candidate: { kind: "speech", text: "La clínica abre a las nueve." } }, expected: ["execute"] },
];
for (const reply of ["Perfecto, muy bien.", "Que sí, coño, que me viene muy bien eso, sí.", "Sí, confírmela, ¿queda reservada?"]) {
  const accepted: ActionInput = { ...base, accepted: [booking], conversation: [...base.conversation, { role: "agent", text: consentOffer }, { role: "caller", text: reply }] };
  actionCases.push({ id: `finish-${actionCases.length}`, input: accepted, expected: ["finish"] });
  actionCases.push({ id: `reject-reconfirmation-${actionCases.length}`, input: { ...accepted, candidate: { kind: "speech", text: "¿Confirma que desea reservar esa cita?" } }, expected: ["revise"] });
}
actionCases.push({ id: "multiple-intents", input: { ...base, accepted: [booking],
  conversation: [{ role: "caller", text: "Quiero reservar la cita del martes 22 y cancelar también mi cita del viernes 25." }, { role: "agent", text: consentOffer }, { role: "caller", text: "Sí, reserve esa cita." }] }, expected: ["execute"] });
actionCases.push({ id: "pending-not-accepted", input: { ...base, pending: { actions: [booking], delivered: true, needsReoffer: false, speech: consentOffer },
  candidate: tool("complete_call", { actions: [booking] }) }, expected: ["revise", "clarify"] });

const rescheduleIdentity: ActionInput = { ...base, evidence: [], conversation: [
  { role: "caller", text: "Quiero mover mi cita del 13 de octubre a las 12:00 al 29 de septiembre a las 9:45 con la doctora Elena Iglesias en Arenal Sur, con Cigna." },
  { role: "agent", text: "¿Me dice su nombre completo y su DNI?" },
  { role: "caller", text: "Mi nombre es Test Example. Mi DNI es 48064716." },
  { role: "agent", text: "¿Me confirma la letra de su DNI?" },
  { role: "caller", text: "La letra E es GEREN." },
] };
actionCases.push(
  { id: "unclear-dni-targeted-question", input: { ...rescheduleIdentity, candidate: { kind: "speech", text: "¿Me repite su DNI completo, con todos los números y la letra final?" } }, expected: ["execute"] },
  { id: "unclear-dni-not-unclear-action", input: { ...rescheduleIdentity, candidate: { kind: "speech", text: "¿Qué desea que haga ahora con su solicitud?" } }, expected: ["revise"] },
  { id: "unclear-dni-no-guessed-letter", input: { ...rescheduleIdentity, candidate: tool("directory", { name: "Test Example", national_id: "48064716Y" }) }, expected: ["revise"] },
);

// Match the production controller input: Jev sees each actual tool contract.
for (const item of actionCases) {
  const candidate = item.input.candidate;
  if (candidate?.kind !== "tool") continue;
  const definition = agentTools.find(tool => tool.function.name === candidate.name)?.function;
  if (definition) item.input.tool_contract = { description: definition.description, parameters: definition.parameters };
}
