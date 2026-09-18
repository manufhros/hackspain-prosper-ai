import { type Outcome } from "../data";
import { type ClinicReader } from "../voice/agent";
import { requestForAction, validateOutcome } from "../validation";

export interface SubmissionReceipt {
  path: string; action_index: number; status?: number;
  accepted: boolean; duplicate?: boolean; dry_run?: boolean; error?: string;
}
/** Exactly one attempt per action, scoped to the carrier's call ID. */
export class ResolutionSubmitter {
  private pending?: Promise<SubmissionReceipt[]>;
  private deadline = Infinity;
  private window = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  receipts: SubmissionReceipt[] = [];
  constructor(private clinic: ClinicReader, private callId: string, private live: boolean,
    private lifetime: AbortSignal, private now = Date.now) {}
  closed(at = this.now()) {
    if (this.deadline !== Infinity) return;
    this.deadline = at + 30_000;
    this.timer = setTimeout(() => this.window.abort(new Error("Submission window closed")), Math.max(0, this.deadline - this.now()));
    this.timer.unref();
  }
  submit(record: Outcome): Promise<SubmissionReceipt[]> {
    if (this.pending) return this.pending;
    const errors = validateOutcome(record);
    if (errors.length) return Promise.reject(new Error(errors.join("; ")));
    const requests = structuredClone(record.actions).map(action => requestForAction(action, this.callId));
    const signal = AbortSignal.any([this.lifetime, this.window.signal]);
    this.pending = Promise.all(requests.map(async (request, action_index): Promise<SubmissionReceipt> => {
      if (!this.live) return { path: request.path, action_index, accepted: false, dry_run: true };
      try {
        signal.throwIfAborted();
        if (this.now() >= this.deadline) throw new Error("Submission window closed");
        const response = await this.clinic.request({ method: "POST", ...request }, signal);
        return { path: request.path, action_index, status: response.status, accepted: response.status === 200 || response.status === 409,
          ...(response.status === 409 ? { duplicate: true } : {}),
          ...([200, 409].includes(response.status) ? {} : { error: response.meaning }) };
      } catch (error) { return { path: request.path, action_index, accepted: false, error: error instanceof Error ? error.message : "Submission failed" }; }
    })).then(receipts => this.receipts = receipts);
    return this.pending;
  }
  dispose() { clearTimeout(this.timer); }
}
