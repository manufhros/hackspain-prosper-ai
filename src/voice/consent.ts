import { type Action } from "../data";
import { fold } from "../validation";

export const needsConsent = (action: Action) => ["BOOK", "RESCHEDULE", "CANCEL", "REGISTER"].includes(action.action);
export const actionKey = (action: Action): string => JSON.stringify(
  typeof action.slot === "string" && Number.isFinite(Date.parse(action.slot)) ? { ...action, slot: new Date(action.slot).toISOString() } : action, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);

export function isCorrection(text: string): boolean {
  return /\b(actually|instead|wait|hold on|change|different|correction|mejor|espera|cambiar|otra|otro|correccion|millor|canviar|altra|altre)\b/.test(fold(text));
}

/** A conservative guard, not a general natural-language consent classifier.
 * Ambiguous replies must be clarified; the model cannot waive this check.
 */
const normalized = (text: string) => fold(text).replace(/[.!¡,;:]+/g, " ").replace(/\s+/g, " ").trim();
const withoutLead = (text: string) => text.replace(/^(?:(?:ah|oh|yes|yeah|yep|ok|okay|si|vale|perfect|perfecto|perfecta|perfecte)\b\s*)+/, "");

export function acceptsOffer(text: string): boolean {
  const value = normalized(text);
  if (!value || /[?¿]/.test(value) || isCorrection(value)) return false;
  if (/\b(no|not|don't|dont|but|pero|if|unless|siempre|except|excepto|although)\b/.test(value)) return false;
  // Do not interpret a yes embedded in a question or sentence continuation as consent.
  if (/\b(which|what|when|where|did|could|would|can you|cual|cuando|donde|puede|pots|quina|quan|on es|si us plau repeteix)\b/.test(value)) return false;
  const stripped = withoutLead(value).replace(/(?:please|por favor|sisplau|gracias|thanks|thank you|muchas gracias)$/, "").trim();
  if (!stripped) return /^(yes|yeah|yep|ok|okay|si|vale|perfect|perfecto|perfecta|perfecte)\b/.test(value);
  return /^(?:that (?:works(?: for me)?|is fine(?: for me)?|suits me)|it works(?: for me)?|please book (?:it|that|that slot)|book (?:it|that|that slot)|i(?:'ll| will) take it|sounds good|that(?:'s| is) (?:fine|great)|go ahead|absolutely|de acuerdo|adelante|me parece bien|d'acord|endavant|esa opcion me parece perfecta|me viene (?:muy )?bien|esa me viene bien|confirmo|confirm it|confirmo esa cita|em va be)(?:\s+(?:please|thanks|thank you|gracias|por favor))?$/.test(stripped);
}

function acceptsOfferedTime(text: string, actions: Action[]): boolean {
  if (actions.length !== 1 || !["BOOK", "RESCHEDULE"].includes(actions[0]!.action)) return false;
  const match = fold(text).match(/^(?:el |the )?(\d{1,2})(?:st|nd|rd|th)? (?:a las |a les |at )(\d{1,2})(?::(\d{2}))? (?:esta bien|me viene bien|em va be|works(?: for me)?|is fine)[.!]*$/);
  if (!match || typeof actions[0]!.slot !== "string") return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(actions[0]!.slot)).map(part => [part.type, part.value]));
  return Number(match[1]) === Number(parts.day) && Number(match[2]) === Number(parts.hour) && Number(match[3] ?? 0) === Number(parts.minute);
}

/** Explicit cancellation acceptance is meaningful only for the pending CANCEL.
 * Keep the whole reply anchored so conditions, another appointment, or a new
 * intent cannot sneak through behind a leading yes.
 */
function acceptsCancellation(text: string, actions: Action[]): boolean {
  if (actions.length !== 1 || actions[0]!.action !== "CANCEL") return false;
  const value = normalized(text.replace(/·/g, " "));
  if (!value || /[?¿]/.test(value) || isCorrection(value)
    || /\b(no|not|don't|dont|but|pero|if|unless|siempre|except|excepto)\b/.test(value)) return false;
  const body = value
    .replace(/^(?:(?:yes|yeah|yep|ok|okay|si|vale|perfecto|perfecte|correcto|correcte|correct|that's right|that is right|de acuerdo|d'acord|me viene bien|em va be)\b\s*)+/, "")
    .replace(/\s+(?:please|thanks|thank you|gracias|por favor|gracies|si us plau|sisplau)$/, "").trim();
  return /^(?:(?:esa|esta) es la cita que quiero cancelar|(?:quiero )?cancelar (?:esa|esta|la) cita|confirmo la cancelacion(?: de (?:esa|esta|la) cita)?|(?:please )?cancel (?:it|that appointment|this appointment)|(?:i confirm|confirm) (?:the )?cancellation(?: of (?:that|this) appointment)?|that(?:'s| is) the appointment i want to cancel|aquesta es la (?:cita|visita) que vull (?:cancel lar|anul lar)|confirmo (?:la (?:cancel lacio|anul lacio)|que vull (?:cancel lar|anul lar))(?: (?:d'aquesta|de la) (?:cita|visita))?)$/.test(body);
}

/** Accept a spoken weekday/time only when every supplied detail matches the offer. */
function acceptsBookingDetails(text: string, actions: Action[], provider?: string): boolean {
  if (actions.length !== 1 || actions[0]!.action !== "BOOK" || typeof actions[0]!.slot !== "string") return false;
  const match = withoutLead(fold(text).replace(/[.!¡,;]+/g, " ").replace(/\s+/g, " ").trim()).match(/^(?:please )?book me (?:for |on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday) at (\d{1,2})(?::(\d{2}))?(?: with (?:dr |doctor )?([a-z ]+))?$/);
  if (!match) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(actions[0]!.slot)).map(part => [part.type, part.value]));
  if (match[1] !== parts.weekday!.toLowerCase() || Number(match[2]) !== Number(parts.hour) || Number(match[3] ?? 0) !== Number(parts.minute)) return false;
  if (match[4]) {
    const names = normalized(provider ?? "").split(" ").filter(word => !["dr", "dra", "doctor", "doctora"].includes(word));
    if (!names.length || !match[4].split(" ").every(word => names.includes(word))) return false;
  }
  return true;
}

export class Consent {
  private pending?: { actions: Action[]; delivered: boolean; needsReoffer: boolean; provider?: string };
  private accepted = new Map<string, Action>();
  offer(actions: Action[], delivered: boolean, provider?: string) { this.pending = { actions: structuredClone(actions), delivered, needsReoffer: false, provider }; }
  delivered() { if (this.pending && !this.pending.needsReoffer) this.pending.delivered = true; }
  interrupt() { this.pending = undefined; }
  get awaitingReoffer() { return this.pending?.needsReoffer ? structuredClone(this.pending) : undefined; }
  get acceptedActions() { return structuredClone([...this.accepted.values()]); }
  hasAccepted(actions: Action[]) { return actions.every(action => this.accepted.has(actionKey(action))); }
  hear(text: string) {
    const cancellation = !!this.pending && acceptsCancellation(text, this.pending.actions);
    if (!cancellation && (isCorrection(text) || /\b(no|not|don't|dont|cancel|forget|rechazo|cancelar)\b/.test(fold(text)))) {
      this.accepted.clear(); this.pending = undefined; return;
    }
    if (!this.pending) return;
    if (this.pending.delivered && (cancellation || acceptsOffer(text) || acceptsOfferedTime(text, this.pending.actions)
      || acceptsBookingDetails(text, this.pending.actions, this.pending.provider))) {
      for (const action of this.pending.actions) this.accepted.set(actionKey(action), structuredClone(action));
      this.pending = undefined;
    } else {
      // Keep the proposal for clarification, but a later yes needs a delivered re-offer.
      this.pending.delivered = false; this.pending.needsReoffer = true;
    }
  }
  check(actions: Action[]) {
    if (actions.some(a => needsConsent(a) && !this.accepted.has(actionKey(a))))
      throw new Error("This exact action has not been offered, fully delivered and explicitly accepted. Use offer_actions, answer any questions, and wait for acceptance. Clarifications, unfinished sentences and identity answers are not consent.");
  }
}
