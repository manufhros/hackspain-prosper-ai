import { generateText, stepCountIs, type ModelMessage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { models } from "../config.ts";
import { clinicTools, type CallContext } from "../clinic/tools.ts";
import { clinicTodayYmd } from "../clinic/normalize.ts";
import { systemPrompt } from "./prompt.ts";

/**
 * El cerebro. Sustituye al LLM conversacional de ElevenLabs: mantiene el
 * historial, llama a las tools y devuelve lo que hay que decir.
 */
export class Conversation {
  private readonly messages: ModelMessage[] = [];
  private hintSet = false;

  constructor(
    private readonly ctx: CallContext,
    directoryHint: string,
  ) {
    this.messages.push({
      role: "system",
      content: systemPrompt({
        callId: ctx.callId,
        fromNumber: ctx.fromNumber,
        madridToday: clinicTodayYmd(),
        directoryHint,
      }),
    });
  }

  /**
   * El hint de directorio llega por una llamada a la API que tarda ~700 ms.
   * No se espera para saludar: se inyecta en cuanto está, siempre antes del
   * primer turno real del paciente.
   */
  setDirectoryHint(hint: string): void {
    if (!hint || this.hintSet) return;
    this.hintSet = true;
    this.messages.push({
      role: "system",
      content: `directory_hint (lookup por from_number, es una pista, no prueba de identidad): ${hint}`,
    });
  }

  async respond(utterance: string): Promise<string> {
    this.messages.push({ role: "user", content: utterance });
    const result = await generateText({
      model: gateway(models.chat),
      messages: this.messages,
      tools: clinicTools(this.ctx),
      // Varios pasos para encadenar directory → availability → submit.
      stopWhen: stepCountIs(8),
    });
    this.messages.push(...result.response.messages);
    return result.text.trim();
  }

  /** Si la llamada muere sin acción terminal, el caso puntúa 0. */
  get needsTerminalAction(): boolean {
    return this.ctx.submitted === null;
  }
}
