import { stripVTControlCharacters } from "node:util";
import { type TraceEvent } from "../voice/agent";
import { type CallIdentity, type PlatformCallReport } from "./call";

// Keep model/caller text on one labeled line, including when stdout is redirected.
const line = (text: string) => stripVTControlCharacters(text)
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();

export class LiveTranscript {
  private next = 0;
  private labels = new Map<string, string>();
  constructor(private write: (text: string) => void = console.log) {}

  private label(call: CallIdentity) {
    let label = this.labels.get(call.session_id);
    if (!label) {
      label = `Call ${++this.next}`;
      this.labels.set(call.session_id, label);
      this.write(`\n[${label}] ===== CONVERSATION START · ${line(call.call_id ?? call.session_id)} =====`);
    }
    return `[${label}]`;
  }

  event = (call: CallIdentity, event: TraceEvent) => {
    if (!["start", "caller", "agent", "interruption"].includes(event.stage)) return;
    const prefix = this.label(call);
    const speaker = { start: "MODE", caller: "CALLER", agent: "RECEPTIONIST", interruption: "INTERRUPTED" }[event.stage];
    this.write(`${prefix} ${speaker}: ${line(event.detail)}`);
  };

  finish(report: PlatformCallReport, saved?: string) {
    const prefix = this.label(report);
    for (const error of report.errors) this.write(`${prefix} ERROR: ${line(error)}`);
    const accepted = report.submissions.filter(receipt => receipt.accepted).length;
    this.write(`${prefix} ===== CONVERSATION END · ${report.status} · ${report.mode === "dry_run" ? "dry run, no submissions" : `${accepted} actions accepted`} =====`);
    this.write(`${prefix} Report: ${saved ? line(saved) : "could not be saved"}\n`);
    this.labels.delete(report.session_id);
  }
}
