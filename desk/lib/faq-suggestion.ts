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

function topicKey(question: string): string {
  const text = normalizeFaqText(question);
  if (/\b(cubre|covered|seguro|asegur)\b/.test(text)) return "cobertura";
  if (/\b(cambiar|change it later|can be changed)\b/.test(text)) return "cambio-posterior";
  if (/\b(sabado|horario|abre)\b/.test(text)) return "horario";
  if (/\b(parking|aparcam)\b/.test(text)) return "parking";
  return text.slice(0, 80);
}

function candidateFromCall(call: Pick<LoggedCall, "motive" | "intent">): string | null {
  const motive = String(call.motive ?? "").trim();
  if (!isPolicyQuestion(motive, call.intent)) return null;
  return motive.replace(/\s+/g, " ").slice(0, 180);
}

/** One frequent uncovered motive from recent calls. No invented copy. */
export function suggestFaqFromCalls(
  calls: Array<Pick<LoggedCall, "motive" | "intent">>,
  faq: Array<Pick<FaqItem, "question">>,
): FaqSuggestion | null {
  const buckets = new Map<string, { question: string; count: number }>();
  for (const call of calls) {
    const question = candidateFromCall(call);
    if (!question || faqCovers(question, faq)) continue;
    const key = topicKey(question);
    if (!key) continue;
    const previous = buckets.get(key);
    buckets.set(key, { question: previous?.question ?? question, count: (previous?.count ?? 0) + 1 });
  }
  const top = [...buckets.values()].sort((left, right) => right.count - left.count || left.question.localeCompare(right.question, "es"))[0];
  if (!top || top.count < 2) return null;
  return {
    question: top.question,
    count: top.count,
    evidence: `${top.count} llamadas recientes con este motivo, sin FAQ que lo cubra.`,
  };
}
