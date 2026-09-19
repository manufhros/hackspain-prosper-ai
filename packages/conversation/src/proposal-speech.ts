import type { ToolResult } from "../../contracts/src/index.js";
/** Speak authoritative proposals without another LLM paraphrase. */
export function proposalSpeech(name: string, result: ToolResult, args: unknown): string | undefined {
  if (!["propose_booking", "propose_cancellation", "propose_registration", "present_proposal"].includes(name) || !result.ok) return;
  const p = result.data as { summary?: string; confirmed?: boolean } | undefined;
  if (!p?.summary || p.confirmed) return;
  const language = (args as { language?: string } | null)?.language;
  const question = language === "es" ? "¿Confirmas que realice esta operación?" : language === "ca" ? "Confirmes que faci aquesta operació?" : "Do you confirm that I should proceed?";
  return `${p.summary} ${question}`;
}
