import { generateSpeech } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { models } from "../config.ts";
import {
  FRAME_SAMPLES,
  PHONE_RATE,
  chunkBytes,
  encodeMuLaw,
  resample,
  wavToPcm16,
} from "../telephony/audio.ts";

const TTS_INSTRUCTIONS =
  "Warm, unhurried clinic receptionist on a phone line. Natural pacing, no shouting.";

const cache = new Map<string, Uint8Array>();

/**
 * Nunca leas en voz alta ids internos: el harness los penaliza y además
 * suenan fatal. Se limpian antes de sintetizar.
 */
function spoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\bP0*\d+\b/gi, "")
    .replace(/\bPR\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sustituye al TTS integrado de ElevenLabs. */
export async function speakToMuLawFrames(text: string): Promise<Uint8Array[]> {
  const phrase = spoken(text);
  if (!phrase) return [];
  const key = `${models.tts}:${models.ttsVoice}:${phrase}`;
  let muLaw = cache.get(key);
  if (!muLaw) {
    const audio = await generateSpeech({
      model: gateway.speechModel(models.tts),
      text: phrase,
      voice: models.ttsVoice,
      outputFormat: "wav",
      speed: 0.97,
      instructions: TTS_INSTRUCTIONS,
      maxRetries: 1,
    });
    const decoded = wavToPcm16(audio.audio.uint8Array);
    muLaw = encodeMuLaw(resample(decoded.pcm, decoded.sampleRate, PHONE_RATE));
    // El saludo y las muletillas se repiten en cada llamada: merece la pena cachear.
    if (cache.size < 32) cache.set(key, muLaw);
  }
  return chunkBytes(muLaw, FRAME_SAMPLES);
}
