import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { models } from "../config.ts";

type Persona = { name: string; data: Record<string, string> };

/** Simula al paciente: responde al recepcionista con SOLO sus datos, un turno
 * corto cada vez, como en una llamada. Sustituye al generador de voz del harness. */
export class CallerSim {
  private readonly messages: { role: "user" | "assistant"; content: string }[] = [];
  private readonly system: string;

  constructor(persona: Persona, callerPrompt: string, language: string) {
    this.system = `You are a patient phoning Clínica Arenal. Stay in character.

Your brief:
${callerPrompt}

Your data (use ONLY this; never invent ids, slots or doctors):
${JSON.stringify(persona.data, null, 1)}

Rules:
- Reply in ${language === "es" ? "Spanish" : language === "en" ? "English" : language}.
- One short, natural spoken turn at a time. You are the caller, not the receptionist.
- Answer what you are asked using your data. Don't dump everything at once.
- If the receptionist has booked, registered, declined or said goodbye, reply with exactly: <END>
- Never read out ids like P00001 or PR03; you don't know those.`;
  }

  /** @param agentLine lo que acaba de decir el recepcionista. */
  async reply(agentLine: string): Promise<string> {
    this.messages.push({ role: "user", content: agentLine });
    const result = await generateText({
      model: gateway(models.chat),
      system: this.system,
      messages: this.messages,
    });
    const text = result.text.trim();
    this.messages.push({ role: "assistant", content: text });
    return text;
  }
}
