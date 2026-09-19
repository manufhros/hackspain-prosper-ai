import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ObjectValue } from "../data";
import { isObject } from "../validation";
import { type AudioReply } from "./runtime";
import { muLawWav, validateSpeechWav } from "./audio-wav";
import { WorkQueue } from "./queue";

export function transcriptionConfig(env: Record<string, string | undefined> = process.env) {
  const provider = env.ASR_PROVIDER?.trim() || "local";
  if (provider !== "local" && provider !== "openrouter") throw new Error("ASR_PROVIDER must be local or openrouter");
  if (provider === "local") return { provider, concurrency: 1 } as const;
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(env[key]?.trim() || fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} must be ${min}–${max}`);
    return n;
  };
  return { provider, model: "openai/whisper-large-v3-turbo", routing: "OpenRouter-managed",
    concurrency: integer("OPENROUTER_ASR_CONCURRENCY", 20, 1, 20),
    timeoutMs: integer("OPENROUTER_ASR_TIMEOUT_MS", 12000, 1000, 60000) } as const;
}
export type TranscriptionConfig = ReturnType<typeof transcriptionConfig>;
export const isTranscription = (operation: string) => operation === "transcribe" || operation === "transcribe_mulaw";

export class OpenRouterTranscription {
  private queue: WorkQueue;
  constructor(private config: Extract<TranscriptionConfig, { provider: "openrouter" }>, private key: string,
    private audioDirectory: string, private request: typeof fetch = fetch) {
    this.queue = new WorkQueue(config.concurrency);
  }
  async audio(operation: string, fields: ObjectValue, signal: AbortSignal): Promise<AudioReply> {
    signal.throwIfAborted();
    if (!isTranscription(operation)) throw new Error("Unsupported remote transcription operation");
    if (fields.language !== undefined && (typeof fields.language !== "string" || !/^[a-z]{2}$/.test(fields.language)))
      throw new Error("Expected a two-letter transcription language hint");
    // Timeout includes local admission, upload, inference and response-body reading.
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]);
    try {
      return await this.queue.run(async queue_ms => {
        bounded.throwIfAborted();
        const started = performance.now();
        let wav: Buffer;
        if (operation === "transcribe_mulaw") wav = muLawWav(fields.payload);
        else {
          if (typeof fields.file !== "string" || !/^[\w-]+\.wav$/.test(fields.file)) throw new Error("Expected a private WAV basename");
          const path = await realpath(join(this.audioDirectory, fields.file));
          if (dirname(path) !== await realpath(this.audioDirectory)) throw new Error("Recording is outside the private audio directory");
          const file = Bun.file(path);
          if (file.size > 1024 * 1024) throw new Error("Recording exceeds upload limit");
          wav = Buffer.from(await file.arrayBuffer());
        }
        validateSpeechWav(wav);
        bounded.throwIfAborted();
        let response: Response;
        try {
          response = await this.request("https://openrouter.ai/api/v1/audio/transcriptions", {
            method: "POST", redirect: "error", signal: bounded,
            headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "El Turno Workbench" },
            body: JSON.stringify({ model: this.config.model, input_audio: { data: wav.toString("base64"), format: "wav" },
              response_format: "verbose_json", temperature: 0, ...(fields.language ? { language: fields.language } : {}) }),
          });
        } catch { bounded.throwIfAborted(); throw new Error("OpenRouter transcription request failed; check the network connection"); }
        if (!response.ok) {
          const hints: Record<number, string> = { 401: "update OPENROUTER_API_KEY", 402: "check OpenRouter credits", 429: "transcription rate limit reached", 404: "transcription model unavailable" };
          throw new Error(`OpenRouter transcription HTTP ${response.status}: ${hints[response.status] ?? "provider request failed"}`);
        }
        let data: unknown;
        try { data = await response.json(); } catch { bounded.throwIfAborted(); throw new Error("OpenRouter transcription returned invalid JSON"); }
        bounded.throwIfAborted();
        if (!isObject(data) || typeof data.text !== "string" || data.text.length > 20000 || data.error)
          throw new Error("OpenRouter transcription returned an invalid transcript");
        const reported = typeof data.language === "string" ? data.language.trim().toLowerCase() : "";
        const language = ({ english: "en", spanish: "es", catalan: "ca" } as Record<string, string>)[reported]
          ?? (/^[a-z]{2}$/.test(reported) ? reported : "unknown");
        const metrics: Record<string, string | number> = { gateway: "openrouter", model: this.config.model, routing: this.config.routing };
        if (typeof data.provider === "string" && /^[a-zA-Z0-9 /_.:-]{1,100}$/.test(data.provider)) metrics.provider = data.provider;
        const id = response.headers.get("x-generation-id");
        if (id && /^[a-zA-Z0-9_.:-]{1,160}$/.test(id)) metrics.generation_id = id;
        if (isObject(data.usage)) for (const field of ["seconds", "cost", "total_tokens", "input_tokens", "output_tokens"]) {
          const value = data.usage[field];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) metrics[field] = value;
        }
        return { text: data.text.trim(), language, decoder: "openrouter", elapsed_ms: Math.round(performance.now() - started), queue_ms, metrics };
      }, bounded);
    } catch (error) {
      signal.throwIfAborted();
      if (bounded.aborted) throw new Error("OpenRouter transcription timed out");
      throw error;
    }
  }
}
