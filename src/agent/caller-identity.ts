export type CallerIdentity = { patientName: string; patientId?: string; insurer?: string };

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && value !== "[redacted]" ? value.trim() : undefined;

/** Only a single directory result identifies a patient; never pick the first candidate. */
export function directoryIdentity(value: unknown): CallerIdentity | undefined {
  const matches = object(value).matches;
  if (!Array.isArray(matches) || matches.length !== 1) return;
  const patient = object(matches[0]);
  const parts = [patient.given_name, patient.first_surname, patient.second_surname];
  if (!text(parts[0]) || parts.some(part => part === "[redacted]")) return;
  return summaryIdentity({ patientName: parts.map(text).filter(Boolean).join(" "),
    patientId: patient.patient_id, insurer: patient.insurer });
}

export function summaryIdentity(value: unknown): CallerIdentity | undefined {
  const row = object(value);
  const patientName = text(row.patientName);
  if (!patientName) return;
  return { patientName, ...(text(row.patientId) ? { patientId: text(row.patientId)! } : {}),
    ...(text(row.insurer) ? { insurer: text(row.insurer)! } : {}) };
}

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
export function spokenIdentity(value: string, previousAgent = ""): CallerIdentity | undefined {
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

export function eventIdentity(type: string, payload: Record<string, unknown>): CallerIdentity | undefined {
  if (type === "patient.identified" || type === "call.ended" || type === "crm.lookup.completed") return summaryIdentity(payload);
  if (type === "tool.completed" && payload.ok !== false && (payload.toolName ?? payload.name) === "search_directory") {
    return directoryIdentity(payload.result);
  }
}
