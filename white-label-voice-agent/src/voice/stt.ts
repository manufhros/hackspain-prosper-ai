import { transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { models } from "../config.ts";
import { PHONE_RATE, pcm16ToWav } from "../telephony/audio.ts";

/** Sustituye al STT integrado de ElevenLabs. */
export async function transcribeUtterance(
  pcm: Int16Array,
  sampleRate = PHONE_RATE,
): Promise<string> {
  const wav = pcm16ToWav(pcm, sampleRate);
  const result = await transcribe({
    model: gateway.transcriptionModel(models.stt),
    audio: wav,
  });
  return result.text.trim();
}
