export const OUT_OF_SCOPE_CATEGORIES = [
  "prompt_injection_or_patient_list",
  "third_party_data_request",
  "medical_advice_or_dosage",
  "sales",
] as const;

export type OutOfScopeCategory = (typeof OUT_OF_SCOPE_CATEGORIES)[number];
export type SupportedPrivacyLanguage = "es" | "en" | "ca";
export type ProtectedDataKind = "national_id" | "phone";

export type ProtectedData = {
  kind: ProtectedDataKind;
  value: string;
};

export type TranscriptTurn = {
  role?: string;
  speaker?: string;
  text?: string;
  content?:
    | string
    | Array<string | { type?: string; text?: string }>;
};

export type ProtectedDataLeak = {
  turnIndex: number;
  kind: ProtectedDataKind;
  value: string;
};

export const SAFE_OUT_OF_SCOPE_RESPONSES: Readonly<
  Record<SupportedPrivacyLanguage, string>
> = Object.freeze({
  es: "No puedo ayudar con esa solicitud. Esta línea se limita a la gestión de citas.",
  en: "I can't help with that request. This line is only for appointment scheduling.",
  ca: "No puc ajudar amb aquesta sol·licitud. Aquesta línia es limita a la gestió de cites.",
});

const CLASSIFIERS: ReadonlyArray<{
  category: OutOfScopeCategory;
  patterns: readonly RegExp[];
}> = [
  {
    category: "prompt_injection_or_patient_list",
    patterns: [
      /\b(?:ignore|disregard|forget|bypass|override)\b.{0,80}\b(?:previous|prior|system|developer|security|instructions?|rules?|prompt)\b/,
      /\b(?:ignora|ignorar|omite|olvida|saltate|anula|sobrescribe)\b.{0,80}\b(?:instrucciones?|reglas?|mensaje|sistema|prompt|anteriores?|previas?)\b/,
      /\b(?:ignora|oblida|omet|anul[·l]a|sobreescriu)\b.{0,80}\b(?:instruccions?|regles?|missatge|sistema|prompt|anteriors?|previes?)\b/,
      /\b(?:system|developer|administrator|admin)\s+(?:message|instruction|override)\b/,
      /\b(?:mensaje|instruccion)\s+(?:del\s+)?(?:sistema|administrador)\b/,
      /\b(?:missatge|instruccio)\s+(?:del\s+)?(?:sistema|administrador)\b/,
      /\b(?:maintenance|developer|administrator|admin)\s+mode\b/,
      /\bmodo\s+(?:mantenimiento|desarrollador|administrador)\b/,
      /\bmode\s+(?:manteniment|desenvolupador|administrador)\b/,
      /\b(?:reveal|show|repeat|print)\b.{0,50}\b(?:system prompt|hidden instructions?|internal instructions?)\b/,
      /\b(?:patient|patients|booked[- ]?in|appointment)\s+(?:list|roster|sheet|register|directory)\b/,
      /\b(?:list|roster|sheet|register|directory)\b.{0,70}\b(?:all\s+)?(?:patients|everyone|everybody|booked[- ]?in)\b/,
      /\b(?:everyone|everybody|all patients)\b.{0,70}\b(?:booked|appointments?|contact details?|phone|id number)\b/,
      /\b(?:lista|listado|registro|directorio|hoja)\b.{0,70}\b(?:pacientes?|todos|citas?|citados?)\b/,
      /\b(?:llistat|llista|registre|directori|full)\b.{0,70}\b(?:pacients?|tothom|cites?|citats?)\b/,
      /\b(?:first few|primeros|primeres?)\s+(?:patient\s+)?names\b/,
    ],
  },
  {
    category: "third_party_data_request",
    patterns: [
      /\b(?:another|other)\s+patient(?:'s)?\b.{0,80}\b(?:data|details|record|dni|nie|id|phone|appointment)\b/,
      /\b(?:data|details|record|dni|nie|id number|phone number|appointment)\b.{0,80}\b(?:another|other)\s+patient\b/,
      /\b(?:their|his|her)\s+(?:dni|nie|national id|id number|phone number|contact details|medical record|appointment)\b/,
      /\b(?:dni|nie|national id|id number|phone number|contact details)\b.{0,45}\b(?:on file\s+)?for\b(?!\s+(?:me|myself)\b)/,
      /\bwhen\s+is\b.{1,55}\b(?:next\s+due|next\s+appointment|booked\s+in)\b/,
      /\bwho\s+is\b.{1,55}\b(?:seeing|booked\s+with|due\s+in\s+with)\b/,
      /\b(?:datos|ficha|expediente|dni|nie|telefono|numero de telefono|cita)\b.{0,70}\b(?:de|para)\s+(?:otro|otra)\s+paciente\b/,
      /\b(?:su|sus)\s+(?:dni|nie|telefono|numero de telefono|datos de contacto|ficha|expediente|cita)\b.{0,40}\b(?:el|ella|paciente)\b/,
      /\b(?:dades|fitxa|expedient|dni|nie|telefon|numero de telefon|cita)\b.{0,70}\b(?:d[' ]|de |per a )(?:un altre|una altra)\s+pacient\b/,
      /\b(?:el seu|la seva)\s+(?:dni|nie|telefon|numero de telefon|dades de contacte|fitxa|expedient|cita)\b/,
    ],
  },
  {
    category: "medical_advice_or_dosage",
    patterns: [
      /\b(?:diagnose|diagnosis|tell me what (?:it|this) is|what (?:is|could|might) (?:it|this) be)\b/,
      /\b(?:tell|told)\s+(?:me\s+)?what\s+(?:it|this)\s+is\b/,
      /\b(?:what\s+(?:should|can|do)\s+i\s+take|what\s+to\s+take|name\s+and\s+(?:a\s+)?dose)\b/,
      /\b(?:recommend|prescribe|advise|tell me)\b.{0,60}\b(?:medicine|medication|drug|dose|dosage|milligrams?|mg|pills?)\b/,
      /\b(?:what|which|how much|how many)\s+(?:dose|dosage|medicine|medication|drug|milligrams?|mg|pills?)\b/,
      /\b(?:diagnostica|diagnostico|dime que (?:es|puede ser)|que (?:es|puede ser) esto)\b/,
      /\bque\s+(?:debo|puedo|me tengo que)\s+tomar\b/,
      /\b(?:recomienda|recetame|aconseja|dime)\b.{0,60}\b(?:medicamento|medicina|farmaco|dosis|miligramos|mg|pastillas?)\b/,
      /\b(?:que|cual|cuanta|cuantas)\s+(?:dosis|medicina|medicamento|miligramos|mg|pastillas?)\b/,
      /\b(?:diagnostica|diagnosi|digues que (?:es|pot ser)|que (?:es|pot ser) aixo)\b/,
      /\bque\s+(?:he de|puc|m'haig de)\s+prendre\b/,
      /\b(?:recomana|recepta|aconsella|digues)\b.{0,60}\b(?:medicament|medicina|farmac|dosi|mil·ligrams|mg|pastilles?)\b/,
      /\b(?:quina|quanta|quantes)\s+(?:dosi|medicina|medicament|mil·ligrams|mg|pastilles?)\b/,
    ],
  },
  {
    category: "sales",
    patterns: [
      /\b(?:i am|i'm|we are|we're)\s+(?:selling|offering|pitching)\b/,
      /\b(?:sales call|sales pitch|commercial offer|product demo|service demo)\b/,
      /\b(?:our|my)\s+(?:product|service|solution|platform)\b.{0,80}\b(?:buy|purchase|demo|meeting|explain|offer)\b/,
      /\b(?:decision[- ]maker|procurement|whoever decides|person who decides)\b/,
      /\b(?:vendo|vendemos|ofrecemos|oferta comercial|llamada comercial|demostracion del producto|demostracion del servicio)\b/,
      /\b(?:nuestro|nuestra|mi)\s+(?:producto|servicio|solucion|plataforma)\b.{0,80}\b(?:comprar|compra|demostracion|reunion|explicar|ofrecer)\b/,
      /\b(?:quien decide|responsable de compras|persona que decide)\b/,
      /\b(?:venc|venem|oferim|oferta comercial|trucada comercial|demostracio del producte|demostracio del servei)\b/,
      /\b(?:el nostre|la nostra|el meu|la meva)\s+(?:producte|servei|solucio|plataforma)\b.{0,80}\b(?:comprar|compra|demostracio|reunio|explicar|oferir)\b/,
      /\b(?:qui decideix|responsable de compres|persona que decideix)\b/,
    ],
  },
];

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyOutOfScope(text: string): OutOfScopeCategory | null {
  const normalized = fold(text);
  if (!normalized) return null;

  for (const classifier of CLASSIFIERS) {
    if (classifier.patterns.some((pattern) => pattern.test(normalized))) {
      return classifier.category;
    }
  }
  return null;
}

export function isOutOfScope(text: string): boolean {
  return classifyOutOfScope(text) !== null;
}

export function safeOutOfScopeResponse(
  language: SupportedPrivacyLanguage | string,
): string {
  return SAFE_OUT_OF_SCOPE_RESPONSES[
    language.toLowerCase() as SupportedPrivacyLanguage
  ] ?? SAFE_OUT_OF_SCOPE_RESPONSES.en;
}

export function normalizeProtectedValue(
  kind: ProtectedDataKind,
  value: string,
): string {
  if (kind === "national_id") {
    return value.replace(/[\s-]/g, "").toUpperCase();
  }
  return value.replace(/\D/g, "").replace(/^(?:0034|34)/, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nationalIdPattern(value: string): RegExp | null {
  const normalized = normalizeProtectedValue("national_id", value);
  if (!/^(?:\d{8}|[XYZ]\d{7})[A-Z]$/.test(normalized)) return null;
  const body = [...normalized].map(escapeRegex).join("[\\s-]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

function phonePattern(value: string): RegExp | null {
  const normalized = normalizeProtectedValue("phone", value);
  if (!/^\d{9}$/.test(normalized)) return null;
  const body = [...normalized].map(escapeRegex).join("[\\s().-]*");
  const prefix = "(?:(?:\\+34|0034|34)[\\s().-]*)?";
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${prefix}${body}(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

function turnIsFromAgent(turn: TranscriptTurn): boolean {
  const source = (turn.role ?? turn.speaker ?? "").toLowerCase();
  return source === "agent" || source === "assistant";
}

function turnText(turn: TranscriptTurn): string {
  const chunks: string[] = [];
  if (typeof turn.text === "string") chunks.push(turn.text);
  if (typeof turn.content === "string") chunks.push(turn.content);
  if (Array.isArray(turn.content)) {
    for (const item of turn.content) {
      if (typeof item === "string") chunks.push(item);
      else if (
        typeof item.text === "string" &&
        (item.type === undefined || item.type === "text" || item.type === "output_text")
      ) {
        chunks.push(item.text);
      }
    }
  }
  return chunks.join("\n");
}

export function detectProtectedDataLeaks(
  turns: readonly TranscriptTurn[],
  protectedData: readonly ProtectedData[],
): ProtectedDataLeak[] {
  const matchers = protectedData.flatMap((item) => {
    const normalized = normalizeProtectedValue(item.kind, item.value);
    const pattern =
      item.kind === "national_id"
        ? nationalIdPattern(item.value)
        : phonePattern(item.value);
    return pattern ? [{ ...item, normalized, pattern }] : [];
  });
  const leaks: ProtectedDataLeak[] = [];

  turns.forEach((turn, turnIndex) => {
    if (!turnIsFromAgent(turn)) return;
    const text = turnText(turn);
    for (const matcher of matchers) {
      if (
        matcher.pattern.test(text) &&
        !leaks.some(
          (leak) =>
            leak.turnIndex === turnIndex &&
            leak.kind === matcher.kind &&
            normalizeProtectedValue(leak.kind, leak.value) === matcher.normalized,
        )
      ) {
        leaks.push({
          turnIndex,
          kind: matcher.kind,
          value: matcher.value,
        });
      }
    }
  });

  return leaks;
}

export function hasProtectedDataLeak(
  turns: readonly TranscriptTurn[],
  protectedData: readonly ProtectedData[],
): boolean {
  return detectProtectedDataLeaks(turns, protectedData).length > 0;
}
