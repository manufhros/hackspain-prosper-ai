import type { LoggedCall } from "./types";

export type FaqItem = { id: string; question: string; answer: string };

export type FaqSuggestion = {
  question: string;
  count: number;
  evidence: string;
};

const BOOKING_NOISE = /\b(soonest|appointment|cita|hueco|disponible|orthopedic|dermatolog|general practice|hay fever|lower back)\b/i;
const POLICY = /\b(cubre|covered|seguro|asegur|horario|s[aá]bado|abre|parking|aparcam|urgenc|anal[ií]tica|precio|cu[aá]nto|documentaci|cambiar|change it later|can be changed)\b/i;

export function normalizeFaqText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function faqCovers(question: string, faq: Array<Pick<FaqItem, "question">>): boolean {
  const needle = normalizeFaqText(question);
  if (!needle || needle.length < 8) return false;
  const key = topicKey(question);
  if (TOPIC_QUESTION[key] && faq.some((item) => topicKey(item.question) === key)) return true;
  return faq.some((item) => {
    const existing = normalizeFaqText(item.question);
    if (!existing) return false;
    return existing === needle || existing.includes(needle) || needle.includes(existing);
  });
}

export function isPolicyQuestion(text: string, intent?: string | null): boolean {
  const value = text.trim();
  if (value.length < 16) return false;
  if (intent === "general_faq") return true;
  if (!/[¿?]/.test(value)) return false;
  if (BOOKING_NOISE.test(value) && !POLICY.test(value)) return false;
  return POLICY.test(value);
}

const TOPIC_QUESTION: Record<string, string> = {
  cobertura: "¿Qué cubre mi seguro?",
  "cambio-posterior": "¿Puedo cambiar la cita más adelante?",
  sabado: "¿Qué centro abre los sábados?",
  horario: "¿Cuál es el horario de los centros?",
  parking: "¿Hay aparcamiento en los centros?",
};

function looksSpanish(text: string) {
  return /[áéíóúñ¿¡]/i.test(text) || /\b(qué|que|cómo|como|cuál|cual|dónde|hay|tienen|abre|puedo|cubre|horario|sábado|cita)\b/i.test(text);
}

function topicKey(question: string): string {
  const text = normalizeFaqText(question);
  if (/\b(cubre|covered|seguro|asegur)\b/.test(text)) return "cobertura";
  if (/\b(cambiar|change it later|can be changed)\b/.test(text)) return "cambio-posterior";
  if (/\b(sabado)\b/.test(text)) return "sabado";
  if (/\b(horario|abre)\b/.test(text)) return "horario";
  if (/\b(parking|aparcam)\b/.test(text)) return "parking";
  return text.slice(0, 80);
}

function questionForTopic(key: string, motive: string): string | null {
  const canonical = TOPIC_QUESTION[key];
  if (canonical) return canonical;
  if (!looksSpanish(motive)) return null;
  return motive.replace(/\s+/g, " ").slice(0, 180);
}

function candidateFromCall(call: Pick<LoggedCall, "motive" | "intent">): { key: string; question: string } | null {
  const motive = String(call.motive ?? "").trim();
  if (!isPolicyQuestion(motive, call.intent)) return null;
  const key = topicKey(motive);
  const question = questionForTopic(key, motive);
  if (!question) return null;
  return { key, question };
}

/** One frequent uncovered motive from recent calls. Topics get a Spanish question. */
export function suggestFaqFromCalls(
  calls: Array<Pick<LoggedCall, "motive" | "intent">>,
  faq: Array<Pick<FaqItem, "question">>,
): FaqSuggestion | null {
  const buckets = new Map<string, { question: string; count: number }>();
  for (const call of calls) {
    const candidate = candidateFromCall(call);
    if (!candidate || faqCovers(candidate.question, faq)) continue;
    const previous = buckets.get(candidate.key);
    buckets.set(candidate.key, {
      question: previous?.question ?? candidate.question,
      count: (previous?.count ?? 0) + 1,
    });
  }
  const top = [...buckets.values()].sort((left, right) => right.count - left.count || left.question.localeCompare(right.question, "es"))[0];
  if (!top || top.count < 2) return null;
  return {
    question: top.question,
    count: top.count,
    evidence: `${top.count} llamadas recientes con este motivo, sin FAQ que lo cubra.`,
  };
}
