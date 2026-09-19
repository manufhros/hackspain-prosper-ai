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

/** Conservative display-name fallback. This never establishes a directory patient ID. */
export function spokenIdentity(value: string, previousAgent = ""): CallerIdentity | undefined {
  const introduction = /(?:\bme llamo|\bmi nombre es|\bsoy|\bmy (?:full )?name is|\bthis is)\s+([^,!?;\n]+)/giu;
  const candidates = [...value.matchAll(introduction)].map(match => match[1] ?? "");
  if (!candidates.length && /(?:\bnombre\b|\bname\b)/i.test(previousAgent) &&
      !/(?:insurance|insurer|aseguradora|seguro|doctor|provider)/i.test(previousAgent)) candidates.push(value.split(",")[0] ?? "");
  for (const candidate of candidates.reverse()) {
    const name = candidate.replace(/\.(?:\s|$).*$/s, "").trim();
    const words = name.split(/\s+/);
    if (words.length < 1 || words.length > 6) continue;
    if (!words.every(word => /^(?:\p{Lu}[\p{L}'’\-]*|de|del|la|las|los|van|von)$/u.test(word))) continue;
    if (/^(?:Yo|Si|Sí|No|Hola|Hello|Hi|Okay|Sure|Gracias|Privado|Sanitas|Adeslas|Doctor|Doctora|Un|Una|El|La|Soy|Me|My|This|I|Hmm|Uh|Um)\b/i.test(name)) continue;
    return { patientName: name };
  }
}

export function eventIdentity(type: string, payload: Record<string, unknown>): CallerIdentity | undefined {
  if (type === "patient.identified" || type === "call.ended" || type === "crm.lookup.completed") return summaryIdentity(payload);
  if (type === "tool.completed" && payload.ok !== false && (payload.toolName ?? payload.name) === "search_directory") {
    return directoryIdentity(payload.result);
  }
}
