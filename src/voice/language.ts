import { fold } from "../validation";

export type CallerUtterance = string | { text: string; language?: string };
export const utteranceParts = (input: CallerUtterance) => typeof input === "string" ? { text: input, language: undefined } : input;

export type SpeechLanguage = "en" | "es" | "ca";
export const speechLanguage = (value: string): value is SpeechLanguage => ["en", "es", "ca"].includes(value);

// Conservative text fallback for typed turns and obvious ASR language mistakes.
// Ambiguous words (hola, si), names and clinic labels deliberately do not vote.
export function textLanguage(text: string): SpeechLanguage | undefined {
  const words = new Set(fold(text).match(/[a-z]+/g) ?? []);
  const vocabulary = {
    en: "hello hi morning please need would appointment my the you thanks yes goodbye earliest what time open",
    es: "buenos buenas necesito quiero cita gracias usted tengo queria puedes fecha llamo",
    ca: "bon voldria vull necessito gracies voste tinc voldriem cita meva trucada dijous visita",
  };
  const scores = Object.entries(vocabulary).map(([language, tokens]) => ({ language: language as SpeechLanguage, score: tokens.split(" ").filter(w => words.has(w)).length }))
    .sort((a, b) => b.score - a.score);
  return scores[0]!.score > 0 && scores[0]!.score > scores[1]!.score ? scores[0]!.language : undefined;
}

export function requestedLanguage(text: string): SpeechLanguage | undefined {
  const value = fold(text);
  // Require a language request, not a mention of a doctor's languages.
  const request = /(?:speak|reply|respond|answer|continue|talk to me|habla(?:rme|r|me)?|hablamos|responde(?:r|me)?|contesta(?:r|me)?|parla(?:r|m)?|respon(?:dre)?|continua(?:r|mos|rme)?)\s+(?:to me\s+|me\s+|in\s+|en\s+)?(english|ingles|angles|spanish|espanol|castellano|castella|catalan|catala)\b/g;
  let result: SpeechLanguage | undefined;
  for (const match of value.matchAll(request)) {
    if (/\b(?:no|not|don't|do not)\s*$/.test(value.slice(0, match.index))) continue;
    result = /^(english|ingles|angles)$/.test(match[1]!) ? "en" : /^(catalan|catala)$/.test(match[1]!) ? "ca" : "es";
  }
  return result;
}

export class ConversationLanguage {
  private preference?: SpeechLanguage;
  private hint?: SpeechLanguage;
  current: SpeechLanguage;
  constructor(initial: string) { this.current = speechLanguage(initial) ? initial : "en"; }
  recognize(language: string) { if (speechLanguage(language)) this.hint = language; }
  update(text: string) {
    this.preference = requestedLanguage(text) ?? this.preference;
    this.current = this.preference ?? textLanguage(text) ?? this.hint ?? this.current;
    this.hint = undefined;
    return this.current;
  }
}
