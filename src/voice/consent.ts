import { type Action, type TranscriptTurn } from "../data";
import { type ConsentDecision, type ConsentInput, type DecideConsent } from "./consent-decision";

export const needsConsent = (action: Action) => ["BOOK", "RESCHEDULE", "CANCEL", "REGISTER"].includes(action.action);
export const actionKey = (action: Action): string => JSON.stringify(
  typeof action.slot === "string" && Number.isFinite(Date.parse(action.slot)) ? { ...action, slot: new Date(action.slot).toISOString() } : action, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);


/** Model interprets language; this state machine alone grants exact-action consent. */
export class Consent {
  private pending?: NonNullable<ConsentInput["pending"]>;
  private accepted = new Map<string, Action>();
  private revision = 0;
  offer(actions: Action[], delivered: boolean, provider?: string, location?: string, speech?: string) {
    this.revision++;
    this.pending = { actions: structuredClone(actions), delivered, needsReoffer: false, provider, location, speech };
  }
  delivered() { if (this.pending && !this.pending.needsReoffer) { this.pending.delivered = true; this.revision++; } }
  interrupt() { this.pending = undefined; this.revision++; }
  get awaitingReoffer() { return this.pending?.needsReoffer ? structuredClone(this.pending) : undefined; }
  get acceptedActions() { return structuredClone([...this.accepted.values()]); }
  hasAccepted(actions: Action[]) { return actions.every(action => this.accepted.has(actionKey(action))); }
  async hear(text: string, conversation: TranscriptTurn[], decide: DecideConsent, signal: AbortSignal): Promise<ConsentDecision | undefined> {
    if (!this.pending && !this.accepted.size) return;
    const revision = this.revision;
    let decision: ConsentDecision;
    try {
      decision = await decide({ reply: text, pending: this.pending ? structuredClone(this.pending) : undefined,
        accepted: this.acceptedActions, conversation: structuredClone(conversation.slice(-6)) }, signal);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (revision === this.revision) { this.accepted.clear(); this.requireReoffer(); }
      throw error;
    }
    // A late response cannot accept an offer replaced or interrupted while in flight.
    if (revision !== this.revision) return;
    if (decision.probability < 0.85) {
      this.accepted.clear(); this.requireReoffer();
    } else if (decision.choice === "change" || decision.choice === "decline") {
      // Never let old consent authorize an action after a correction or withdrawal.
      if (decision.choice === "change" || !this.pending) this.accepted.clear();
      this.pending = undefined;
    } else if (decision.choice === "accept" && this.pending?.delivered && !this.pending.needsReoffer) {
      for (const action of this.pending.actions) this.accepted.set(actionKey(action), structuredClone(action));
      this.pending = undefined;
    } else this.requireReoffer();
    this.revision++;
    return decision;
  }
  private requireReoffer() {
    if (this.pending) { this.pending.delivered = false; this.pending.needsReoffer = true; }
  }
  check(actions: Action[]) {
    if (actions.some(a => needsConsent(a) && !this.accepted.has(actionKey(a))))
      throw new Error("This exact action has not been offered, fully delivered and explicitly accepted. Use offer_actions, answer any questions, and wait for acceptance. Clarifications, unfinished sentences and identity answers are not consent.");
  }
}
