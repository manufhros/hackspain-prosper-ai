import type { LoggedCall } from "./types";

const INTENT_CODES = new Set(["appointment_action", "general_faq", "medical_emergency"]);

const CONFIRMED = new Set(["cita", "alta", "escalado", "sin_cita", "cancelacion", "cambio"]);

type Turn = { speaker: string; text: string };

type Spoken = { patientName: string; patientId?: string; insurer?: string };

const PARTICLE = /^(?:de|del|la|las|los|van|von)$/iu;
const TITLED = /^(?:\p{Lu}[\p{L}'’\-]*|de|del|la|las|los|van|von)$/u;
const LETTERS = /^(?:\p{L}[\p{L}'’\-]*)$/u;
const NOT_NAME = /^(?:Yo|Si|Sí|No|Hola|Hello|Hi|Okay|Sure|Gracias|Privado|Sanitas|Adeslas|Doctor|Doctora|Un|Una|El|La|Soy|Me|My|This|I|Hmm|Uh|Um|Porque|Necesito|Quiero|Para|Con|Cita|Appointment)$/iu;

function titleName(name: string) {
  return name.split(/\s+/).map((word, index) => {
    if (index > 0 && PARTICLE.test(word)) return word.toLowerCase();
    return word.charAt(0).toLocaleUpperCase("es-ES") + word.slice(1);
  }).join(" ");
}

/** Conservative display-name fallback. This never establishes a directory patient ID. */
function spokenIdentity(value: string, previousAgent = ""): Spoken | undefined {
  const loose = /(?:\bme llamo|\bmi nombre es|\bmy (?:full )?name is)\s+([^,!?;\n]+)/giu;
  const strict = /(?:\bsoy|\bthis is)\s+([^,!?;\n]+)/giu;
  const looseHits = [...value.matchAll(loose)].map(match => match[1] ?? "");
  const strictHits = [...value.matchAll(strict)].map(match => match[1] ?? "");
  const answered = !looseHits.length && !strictHits.length && /(?:\bnombre\b|\bname\b)/i.test(previousAgent) &&
    !/(?:insurance|insurer|aseguradora|seguro|doctor|provider)/i.test(previousAgent)
    ? [value.split(",")[0] ?? ""] : [];
  const candidates = [
    ...looseHits.map(text => ({ text, allowLower: true })),
    ...strictHits.map(text => ({ text, allowLower: false })),
    ...answered.map(text => ({ text, allowLower: false })),
  ];
  for (const candidate of candidates.reverse()) {
    const name = candidate.text.replace(/\.(?:\s|$).*$/s, "").trim();
    const words = name.split(/\s+/);
    if (words.length < 1 || words.length > 6) continue;
    const titled = words.every(word => TITLED.test(word));
    if (!titled) {
      if (!candidate.allowLower || words.length < 2 || !words.every(word => LETTERS.test(word) || PARTICLE.test(word))) continue;
    }
    if (NOT_NAME.test(name) || words.some(word => NOT_NAME.test(word) && !PARTICLE.test(word))) continue;
    return { patientName: titled ? name : titleName(name) };
  }
}

function substantive(text: string) {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const rest = normalized.replace(/\b(hello|hi|hey|hola|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|yes|yeah|si|okay|ok|gracias|thanks|thank you|um|uh|hmm|mhm|vale|por favor|please)\b/g, "").trim();
  if (/^(?:can you hear me|are you still there|is anyone there|me oyes|me escuchas|em sentiu|probando|testing|test|one two three|uno dos tres)[ ?]*$/.test(rest)) return false;
  return rest.split(/\s+/).filter(Boolean).length >= 3 || /\b(cita|appointment|cancelar|cancel|doctor|recepcion|emergencia|register|registrar|horario)\b/.test(rest);
}

function motiveFrom(text: string | null | undefined) {
  const value = text?.trim() ?? "";
  return value ? value.slice(0, 160) : "";
}

export function enrichCall(call: LoggedCall, turns: Turn[]): LoggedCall {
  let previousAgent = "";
  let spoken;
  let motive = INTENT_CODES.has(call.motive) ? "" : call.motive;
  for (const turn of turns) {
    if (turn.speaker === "agent") previousAgent = turn.text;
    else {
      spoken = spokenIdentity(turn.text, previousAgent) ?? spoken;
      if (!motive && substantive(turn.text)) motive = motiveFrom(turn.text);
    }
  }
  return {
    ...call,
    patient: call.patient || spoken?.patientName || null,
    patientId: call.patientId || spoken?.patientId || null,
    insurer: call.insurer || spoken?.insurer || null,
    motive: motive || call.motive,
  };
}

export function enrichCalls(
  calls: LoggedCall[],
  turns: Array<Turn & { call_id: string }>,
): LoggedCall[] {
  const byCall = new Map<string, Turn[]>();
  for (const turn of turns) {
    const list = byCall.get(turn.call_id) ?? [];
    list.push(turn);
    byCall.set(turn.call_id, list);
  }
  return calls.map((call) => enrichCall(call, byCall.get(call.id) ?? []));
}

/** Greeting-only hangups stay out of the hospital board. Confirmed outcomes stay. */
export function isRecordedCall(call: LoggedCall) {
  if (CONFIRMED.has(call.outcome)) return true;
  if (call.patient) return true;
  const motive = call.motive?.trim() ?? "";
  return Boolean(motive) && !INTENT_CODES.has(motive);
}
