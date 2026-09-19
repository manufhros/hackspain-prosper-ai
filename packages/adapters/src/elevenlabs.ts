import { STT_LANGUAGE_OPTIONS } from "../../conversation/src/language.js";
import {
  TELEPHONE_AUDIO,
  sameFormat,
  type AudioFrame,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type Transcript,
} from "../../contracts/src/index.js";
import {
  AsyncQueue,
  opened,
  socketFactory,
  type SocketFactory,
} from "./socket.js";
import type WebSocket from "ws";
export class SynthesisProviderError extends Error {
  constructor(readonly code: string) { super(`Synthesis provider error: ${code}`); }
}
export class ElevenLabsRecognizer implements SpeechRecognizer {
  private socket?: WebSocket;
  private closed = false;
  constructor(
    private key: string,
    private connect: SocketFactory = socketFactory,
  ) {}
  async start(
    onText: (text: Transcript) => void,
    onError: (error: Error) => void,
  ) {
    const query = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "ulaw_8000",
      commit_strategy: "vad",
      include_language_detection: "true",
      language_code: STT_LANGUAGE_OPTIONS.languageCode,
    });
    for (const language of STT_LANGUAGE_OPTIONS.secondaryLanguages) query.append("secondary_languages", language);
    const socket = (this.socket = this.connect(
      `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query}`,
      { "xi-api-key": this.key },
    ));
    socket.on("error", () => onError(new Error("Recognizer connection error")));
    socket.on("close", () => {
      if (!this.closed) onError(new Error("Recognizer disconnected"));
    });
    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as {
          message_type: string;
          text?: string;
          language_code?: string;
        };
        if (
          event.message_type === "partial_transcript" ||
          event.message_type === "committed_transcript"
        )
          onText({
            text: event.text ?? "",
            final: event.message_type === "committed_transcript",
          });
        else if(event.message_type==='committed_transcript_with_timestamps' && event.language_code)
          onText({text:event.text??'',final:true,language:event.language_code,metadataOnly:true});
        else if (event.message_type.includes("error"))
          onError(new Error("Recognizer provider error"));
      } catch {
        onError(new Error("Invalid recognizer event"));
      }
    });
    await opened(socket);
  }
  write(frame: AudioFrame) {
    if (!sameFormat(frame.format, TELEPHONE_AUDIO))
      throw new Error("Recognizer expects mulaw/8000");
    if (this.socket?.readyState !== 1)
      throw new Error("Recognizer is not ready");
    this.socket.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: Buffer.from(frame.data).toString("base64"),
        sample_rate: 8000,
      }),
    );
  }
  async close() {
    this.closed = true;
    this.socket?.close();
  }
}
export class ElevenLabsSynthesizer implements SpeechSynthesizer {
  constructor(
    private key: string,
    private voice: string,
    private connect: SocketFactory = socketFactory,
  ) {}
  async *synthesize(
    text: string,
    signal: AbortSignal,
  ): AsyncIterable<AudioFrame> {
    const queue = new AsyncQueue<AudioFrame>();
    const socket = this.connect(
      "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v3_conversational&output_format=ulaw_8000",
      { "xi-api-key": this.key },
    );
    let finished = false;
    const abort = () => {
      queue.end(new Error("Aborted"));
      socket.close();
    };
    const timeout = setTimeout(() => {
      queue.end(new Error("Synthesis timeout"));
      socket.close();
    }, 20000);
    signal.addEventListener("abort", abort, { once: true });
    socket.on("error", () =>
      queue.end(new Error("Synthesis connection error")),
    );
    socket.on("close", () =>
      queue.end(finished ? undefined : new Error("Synthesis disconnected")),
    );
    socket.on("message", (raw) => {
      try {
        const e = JSON.parse(raw.toString()) as {
          audio?: string;
          is_final_audio_for_turn?: boolean;
          error?: unknown;
        };
        if (e.error) {
          const code = typeof e.error === "string" && ["quota_exceeded", "rate_limit_exceeded", "too_many_concurrent_requests", "invalid_api_key", "voice_not_found"].includes(e.error) ? e.error : "provider_error";
          queue.end(new SynthesisProviderError(code));
          return;
        }
        if (e.audio)
          queue.push({
            data: Buffer.from(e.audio, "base64"),
            format: TELEPHONE_AUDIO,
          });
        if (e.is_final_audio_for_turn) {
          finished = true;
          queue.end();
        }
      } catch {
        queue.end(new Error("Invalid synthesis event"));
      }
    });
    try {
      await opened(socket, signal);
      socket.send(JSON.stringify({ voices: [this.voice] }));
      socket.send(
        JSON.stringify({
          inputs: [{ text, voice_id: this.voice, new_turn: true }],
          flush: true,
        }),
      );
      for await (const frame of queue) {
        signal.throwIfAborted();
        yield frame;
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      socket.close();
    }
  }
}
