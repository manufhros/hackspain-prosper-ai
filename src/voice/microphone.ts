import { type TerminalPort } from "../terminal";
import { type Inference } from "./runtime";
import { type CallerUtterance } from "./language";

export const RECORDING_LIMIT_MS = 30_000;

/** Shared caller input for free conversations and case rehearsals. */
export async function microphoneInput(
  terminal: Pick<TerminalPort, "ask" | "choose">,
  inference: Pick<Inference, "audio" | "removeAudio">,
  signal: AbortSignal,
  status: (message: string) => void,
): Promise<CallerUtterance | null> {
  while (!signal.aborted) {
    const choice = await terminal.choose("YOUR TURN · Space: talk · t: type · Esc: end call", ["space", "return", "t"], signal);
    if (choice === null) return null;
    if (choice === "t") {
      const text = await terminal.ask("Your reply", "", false, signal);
      if (text?.trim()) return text.trim();
      continue; // Cancelling the text editor returns to caller controls.
    }
    const file = `${crypto.randomUUID()}.wav`;
    let recording = false;
    try {
      status("Opening microphone… macOS may request permission.");
      await inference.audio("record_start", {}, signal);
      recording = true;
      signal.throwIfAborted();
      const started = performance.now();
      status("Microphone on · Space sends · Esc discards this take");
      const stop = await terminal.choose(
        () => `● RECORDING ${Math.min(30, Math.floor((performance.now() - started) / 1000))} / 30s · Space: send · Esc: discard`,
        ["space", "return"], signal, RECORDING_LIMIT_MS,
      );
      signal.throwIfAborted();
      if (stop === null) {
        status("Recording discarded. Space to try again, or Esc to end the call.");
        continue;
      }
      status(stop === "timeout" ? "30-second limit reached · transcribing…" : "Microphone off · transcribing…");
      const captured = await inference.audio("record_stop", { file }, signal);
      recording = false;
      const heard = captured.file ? await inference.audio("transcribe", { file }, signal) : captured;
      if (heard.text?.trim()) return { text: heard.text.trim(), language: heard.language };
      status("No speech detected. Space to try again, or t to type.");
    } finally {
      try {
        // Esc discards a take without aborting the runtime. Parent cancellation
        // still uses the runtime's existing process cleanup policy.
        if (recording) {
          try { await inference.audio("record_cancel", {}, AbortSignal.timeout(5000)); }
          catch (error) { if (!signal.aborted) throw error; }
        }
      } finally { await inference.removeAudio(file); }
    }
  }
  return null;
}
