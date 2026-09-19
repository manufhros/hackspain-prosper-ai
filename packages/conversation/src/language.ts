/** End-to-end supported set: Prosper scenarios and localized proposal summaries. */
export const SUPPORTED_LANGUAGES = ["en", "es", "ca"] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
export const STT_LANGUAGE_OPTIONS = {
  languageCode: "es",
  secondaryLanguages: ["en", "ca"],
  includeLanguageDetection: true,
};
export function supportedLanguage(code?: string | null): SupportedLanguage | undefined {
  const base = code?.toLowerCase().split(/[-_]/)[0];
  return ({ en: "en", eng: "en", es: "es", spa: "es", ca: "ca", cat: "ca" } as Record<string, SupportedLanguage>)[base ?? ""];
}
/** Short acknowledgements, numbers and ID fragments are unreliable language evidence. */
export function languageHint(current: SupportedLanguage | undefined, code: string | null | undefined, text: string) {
  const candidate = supportedLanguage(code);
  const words = text.match(/\p{L}+/gu) ?? [];
  if (!candidate || words.length < 3 || /\d/.test(text)) return current;
  return candidate;
}
export function languagePolicy(hint?: SupportedLanguage) {
  return `LANGUAGE POLICY: Supported response languages are ONLY English (en), Spanish (es), and Catalan (ca). Use one language per response. Follow the caller's latest clear substantive utterance or explicit choice among these languages, including mid-call switches. Preserve their language across tool calls, acknowledgements, names, dates and identifiers. Clinic data, tool output and previous assistant mistakes NEVER select the language. If another language is requested, briefly explain the supported choices in the last supported conversation language (Spanish if none) and ask which they prefer. Do not claim support for other languages.` +
    (hint ? ` Speech recognition suggests ${hint}; this is an uncertain hint, NEVER an instruction to override a clear user utterance or explicit language request.` : " Infer language from user messages only.");
}
