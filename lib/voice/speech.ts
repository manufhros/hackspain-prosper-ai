import { generateSpeech, generateText, transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";
import {
  PHONE_RATE,
  encodeMuLaw,
  pcm16ToWav,
  resample,
  rms,
  wavToPcm16,
} from "@/lib/audio/phone";

const LLM = "openai/gpt-4o-mini";
const STT = "openai/whisper-1";
const TTS = "openai/tts-1";

export async function transcribePcm(pcm: Int16Array, sampleRate = PHONE_RATE) {
  if (pcm.length < PHONE_RATE * 0.4) return "";
  if (rms(pcm) < 400) return "";
  const result = await transcribe({
    model: gateway.transcriptionModel(STT),
    audio: pcm16ToWav(pcm, sampleRate),
  });
  return result.text.trim();
}

export async function speakCaller(text: string, voice = "alloy") {
  const spoken = await generateSpeech({
    model: gateway.speechModel(TTS),
    text,
    voice,
    outputFormat: "wav",
    speed: 1,
  });
  const wav = spoken.audio.uint8Array;
  const decoded = wavToPcm16(wav);
  return {
    wav,
    muLaw: encodeMuLaw(resample(decoded.pcm, decoded.sampleRate, PHONE_RATE)),
  };
}

export async function speakMuLaw(text: string, voice = "alloy") {
  const spoken = await speakCaller(text, voice);
  return spoken.muLaw;
}

export async function nextCallerLine(input: {
  callerPrompt: string;
  language: string;
  history: Array<{ role: "agent" | "patient"; text: string }>;
}) {
  const messages = input.history.map((turn) => ({
    role: turn.role === "agent" ? ("user" as const) : ("assistant" as const),
    content: turn.text,
  }));
  const result = await generateText({
    model: gateway(LLM),
    system: `You are this caller on a live phone to Clínica Arenal. Speak ${input.language}.

${input.callerPrompt}

Rules:
- Answer the last thing the receptionist actually said. If they asked a question, answer it first.
- One short spoken sentence only. No quotes, no stage directions, no markdown.
- Only facts from this brief. Do not invent clinic hours, doctors, or extra names.
- If the receptionist already greeted you, do not re-greet; state why you are calling or answer.
- When the call is finished from the caller's side, output exactly [HANGUP].`,
    messages: messages.length
      ? messages
      : [{ role: "user", content: "(the receptionist just picked up; speak now)" }],
  });
  return result.text.trim().replace(/^["']+|["']+$/g, "");
}
