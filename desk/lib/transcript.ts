import type { TranscriptEntry } from "./types";

/** Same speaker and text within a second is the text log plus the structured event. */
export function dedupeTurns(turns: TranscriptEntry[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const turn of turns) {
    const prev = out.at(-1);
    if (
      prev &&
      prev.speaker === turn.speaker &&
      prev.text === turn.text &&
      Math.abs(Date.parse(prev.at) - Date.parse(turn.at)) <= 1000
    ) {
      continue;
    }
    out.push(turn);
  }
  return out;
}
