import { z } from "zod";
import {
  TextEngine,
  PipelineEngine,
} from "../../../packages/conversation/src/engines.js";
import { OpenAITextModel } from "../../../packages/adapters/src/openai-text.js";
import {
  ElevenLabsRecognizer,
  ElevenLabsSynthesizer,
} from "../../../packages/adapters/src/elevenlabs.js";
import { RealtimeEngine } from "../../../packages/adapters/src/realtime.js";
import { LiveKitEngine } from "../../../packages/adapters/src/livekit.js";
const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(7860),
  ENGINE: z.enum(["text", "pipeline", "realtime", "livekit"]).default("text"),
  CLINIC: z.enum(["fixture", "prosper"]).default("fixture"),
  STORE: z.enum(["memory", "file", "postgres"]).default("file"),
  DATA_DIR: z.string().default(".data"),
  CONSOLE_TOKEN: z.string().default(""),
  TRANSPORT_TOKEN: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime-2.1"),
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_VOICE_ID: z.string().default(""),
  PLATFORM_API_BASE_URL: z
    .string()
    .url()
    .default("https://hackspain.getprosperapp.com"),
  PLATFORM_API_KEY: z.string().default(""),
  DATABASE_URL: z.string().default(""),
});
export type Config = z.infer<typeof schema>;
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const need = (key: keyof Config) => {
    if (!c[key]) throw new Error(`Missing ${key}`);
  };
  if (!["127.0.0.1", "localhost", "::1"].includes(c.HOST)) {
    need("CONSOLE_TOKEN");
    need("TRANSPORT_TOKEN");
  }
  if (c.ENGINE !== "text") need("OPENAI_API_KEY");
  if (c.ENGINE === "pipeline" || c.ENGINE === "livekit") {
    need("ELEVENLABS_API_KEY");
    need("ELEVENLABS_VOICE_ID");
  }
  if (c.CLINIC === "prosper") {
    need("PLATFORM_API_KEY");
    need("TRANSPORT_TOKEN");
    if (c.ENGINE === "text") throw new Error("Prosper requires a voice engine");
  }
  if (c.STORE === "postgres") need("DATABASE_URL");
  return c;
}
/** Composition root: vendor choices never leak into domain/application. */
export function engineFactory(c: Config) {
  return () =>
    c.ENGINE === "text"
      ? new TextEngine()
      : c.ENGINE === "realtime"
        ? new RealtimeEngine(c.OPENAI_API_KEY, c.OPENAI_REALTIME_MODEL)
        : c.ENGINE === "livekit"
          ? new LiveKitEngine({
              openaiKey: c.OPENAI_API_KEY,
              model: c.OPENAI_TEXT_MODEL,
              elevenlabsKey: c.ELEVENLABS_API_KEY,
              voiceId: c.ELEVENLABS_VOICE_ID,
            })
          : new PipelineEngine(
              new OpenAITextModel(c.OPENAI_API_KEY, c.OPENAI_TEXT_MODEL),
              new ElevenLabsRecognizer(c.ELEVENLABS_API_KEY),
              new ElevenLabsSynthesizer(
                c.ELEVENLABS_API_KEY,
                c.ELEVENLABS_VOICE_ID,
              ),
            );
}
