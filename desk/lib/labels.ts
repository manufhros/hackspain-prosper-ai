/** Human labels for the codes the voice agent writes into the call log. */

export const REASON_LABEL: Record<string, string> = {
  medical_emergency: "Urgencia médica",
  human_requested: "Pidió una persona",
  out_of_scope: "Fuera de alcance",
  frustration: "Frustración alta",
  tool_failure: "Fallo de herramienta",
  no_availability: "Sin disponibilidad",
  location_not_covered: "Centro no cubierto",
  specialty_not_covered: "Especialidad no cubierta",
  allowance_exhausted: "Cobertura agotada",
  referral_required: "Requiere derivación",
  insurer_referral_required: "Derivación de la aseguradora",
  not_eligible_age: "Edad no admitida",
  policy: "Norma del centro",
};

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (REASON_LABEL[reason]) return REASON_LABEL[reason];
  /* Booking outcomes reuse `reason` for the slot timestamp; that is not a reason. */
  if (/^\d{4}-\d{2}-\d{2}T/.test(reason)) return null;
  return reason.replaceAll("_", " ");
}

export const TOOL_LABEL: Record<string, string> = {
  search_directory: "Buscar en directorio",
  search_availability: "Buscar huecos",
  list_appointments: "Consultar próximas citas",
  submit_book: "Reservar cita",
  submit_register: "Registrar paciente",
  submit_cancel: "Cancelar cita",
  submit_reschedule: "Cambiar cita",
  submit_no_action: "Cerrar sin acción",
  submit_escalate: "Escalar al equipo humano",
  handoff_context: "Contexto entregado al equipo humano",
};

export const INSURER_LABEL: Record<string, string> = {
  sanitas: "Sanitas",
  adeslas: "Adeslas",
  dkv: "DKV",
  mapfre: "Mapfre",
  asisa: "ASISA",
  caser: "Caser",
  cigna: "Cigna",
  axa: "AXA",
};

export const INTENT_LABEL: Record<string, string> = {
  appointment_action: "Gestión de citas",
  general_faq: "Información general",
  medical_emergency: "Urgencia médica",
};

export function intentLabel(intent: string | null | undefined): string | null {
  if (!intent) return null;
  return INTENT_LABEL[intent] ?? intent.replaceAll("_", " ");
}

/** What the caller came for — their words, else the recorded intent. Not the closing outcome. */
export function callReason(call: { motive?: string | null; intent?: string | null }): string | null {
  const motive = call.motive?.trim() ?? "";
  if (motive && motive !== call.intent && !INTENT_LABEL[motive]) return motive;
  return intentLabel(call.intent ?? (INTENT_LABEL[motive] ? motive : null));
}
