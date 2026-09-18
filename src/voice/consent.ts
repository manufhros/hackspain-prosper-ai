import { type Action } from "../data";
import { fold } from "../validation";

export const needsConsent = (action: Action) => ["BOOK", "RESCHEDULE", "CANCEL", "REGISTER"].includes(action.action);
export const actionKey = (action: Action): string => JSON.stringify(action, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);

export function isCorrection(text: string): boolean {
  return /\b(actually|instead|wait|hold on|change|different|correction|mejor|espera|cambiar|otra|otro|correccion|millor|canviar|altra|altre)\b/.test(fold(text));
}

/** A conservative guard, not a general natural-language consent classifier.
 * Ambiguous replies must be clarified; the model cannot waive this check.
 */
export function acceptsOffer(text: string): boolean {
  const value = fold(text).replace(/[.!¡,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /[?¿]/.test(value) || isCorrection(value)) return false;
  if (/\b(no|not|don't|dont|but|pero|if|unless|siempre|except|excepto|although)\b/.test(value)) return false;
  // Do not interpret a yes embedded in a question or sentence continuation as consent.
  if (/\b(which|what|when|where|did|could|would|can you|cual|cuando|donde|puede|pots|quina|quan|on es|si us plau repeteix)\b/.test(value)) return false;
  const stripped = value.replace(/^(yes|yeah|yep|ok|okay|si|vale|perfect|perfecto|perfecta|perfecte)\b\s*/, "").replace(/(?:please|por favor|sisplau|gracias|thanks|thank you|muchas gracias)$/, "").trim();
  if (!stripped) return /^(yes|yeah|yep|ok|okay|si|vale|perfect|perfecto|perfecta|perfecte)\b/.test(value);
  return /^(?:that (?:works|is fine|suits me)|it works(?: for me)?|please book (?:it|that|that slot)|book (?:it|that|that slot)|i(?:'ll| will) take it|esa opcion me parece perfecta|me viene (?:muy )?bien|esa me viene bien|confirmo|confirm it|confirmo esa cita|em va be)(?:\s+(?:please|thanks|thank you|gracias|por favor))?$/.test(stripped);
}

function acceptsOfferedTime(text: string, actions: Action[]): boolean {
  if (actions.length !== 1 || !["BOOK", "RESCHEDULE"].includes(actions[0]!.action)) return false;
  const match = fold(text).match(/^(?:el |the )?(\d{1,2})(?:st|nd|rd|th)? (?:a las |a les |at )(\d{1,2})(?::(\d{2}))? (?:esta bien|me viene bien|em va be|works(?: for me)?|is fine)[.!]*$/);
  if (!match || typeof actions[0]!.slot !== "string") return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(actions[0]!.slot)).map(part => [part.type, part.value]));
  return Number(match[1]) === Number(parts.day) && Number(match[2]) === Number(parts.hour) && Number(match[3] ?? 0) === Number(parts.minute);
}

export class Consent {
  private pending?: { actions: Action[]; delivered: boolean };
  private accepted = new Set<string>();
  offer(actions: Action[], delivered: boolean) { this.pending = { actions: structuredClone(actions), delivered }; }
  delivered() { if (this.pending) this.pending.delivered = true; }
  interrupt() { this.pending = undefined; }
  hear(text: string) {
    if (isCorrection(text)) this.accepted.clear();
    if (this.pending?.delivered && (acceptsOffer(text) || acceptsOfferedTime(text, this.pending.actions))) for (const action of this.pending.actions) this.accepted.add(actionKey(action));
    // A question is not a yes later in the same turn. Re-offer after answering it.
    this.pending = undefined;
  }
  check(actions: Action[]) {
    if (actions.some(a => needsConsent(a) && !this.accepted.has(actionKey(a))))
      throw new Error("This exact action has not been offered, fully delivered and explicitly accepted. Use offer_actions, answer any questions, and wait for acceptance. Clarifications, unfinished sentences and identity answers are not consent.");
  }
}
