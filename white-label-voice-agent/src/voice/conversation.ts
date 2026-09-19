import { generateText, stepCountIs, type ModelMessage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { models } from "../config.ts";
import { clinicTools, type CallContext } from "../clinic/tools.ts";
import { clinicTodayYmd } from "../clinic/normalize.ts";
import { systemPrompt } from "./prompt.ts";

/**
 * El cerebro. Sustituye al LLM conversacional de ElevenLabs: mantiene el
 * historial, llama a las tools y devuelve lo que hay que decir.
 *
 * Esta versión del AI SDK rechaza mensajes role:"system" dentro de `messages`
 * (AI_InvalidPromptError). El prompt del sistema va por el parámetro `system`
 * de generateText, y `messages` solo lleva user/assistant/tool.
 */
export class Conversation {
  private readonly messages: ModelMessage[] = [];
  private readonly basePrompt: string;
  private directoryHint = "";
  private hintSet = false;

  constructor(
    private readonly ctx: CallContext,
    directoryHint: string,
  ) {
    this.directoryHint = directoryHint;
    this.basePrompt = systemPrompt({
      callId: ctx.callId,
      fromNumber: ctx.fromNumber,
      madridToday: clinicTodayYmd(),
      directoryHint,
    });
  }

  /**
   * El hint de directorio llega por una llamada a la API que tarda ~700 ms.
   * No se espera para saludar: se inyecta en el system prompt en cuanto está,
   * siempre antes del primer turno real del paciente.
   */
  setDirectoryHint(hint: string): void {
    if (!hint || this.hintSet) return;
    this.hintSet = true;
    this.directoryHint = hint;
  }

  private get system(): string {
    // El prompt base ya incluyó el hint que hubiera al construir; si llegó
    // después, lo añadimos aquí para no perderlo.
    if (this.hintSet) {
      return `${this.basePrompt}\n\ndirectory_hint (lookup por from_number, es una pista, no prueba de identidad): ${this.directoryHint}`;
    }
    return this.basePrompt;
  }

  async respond(utterance: string): Promise<string> {
    this.messages.push({ role: "user", content: utterance });
    const result = await generateText({
      model: gateway(models.chat),
      system: this.system,
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
