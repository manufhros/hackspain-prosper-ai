/** A caller turn that states a reason to call, not a greeting or microphone check. */
export function substantive(text: string) {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const rest = normalized.replace(/\b(hello|hi|hey|hola|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|yes|yeah|si|okay|ok|gracias|thanks|thank you|um|uh|hmm|mhm|vale|por favor|please)\b/g, "").trim();
  if (/^(?:can you hear me|are you still there|is anyone there|me oyes|me escuchas|em sentiu|probando|testing|test|one two three|uno dos tres)[ ?]*$/.test(rest)) return false;
  return rest.split(/\s+/).filter(Boolean).length >= 3 || /\b(cita|appointment|cancelar|cancel|doctor|recepcion|emergencia|register|registrar|horario)\b/.test(rest);
}

export function motiveFrom(text: string | null | undefined) {
  const value = text?.trim() ?? "";
  return value ? value.slice(0, 160) : "";
}
