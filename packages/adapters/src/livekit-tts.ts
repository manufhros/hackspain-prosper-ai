import { SynthesisProviderError } from "./elevenlabs.js";
import { tts, tokenize, type APIConnectOptions } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { randomUUID } from "node:crypto";
import type { SpeechSynthesizer } from "../../contracts/src/index.js";
import { decodeMulaw } from "./livekit-audio.js";

/** Preserve our ElevenLabs v3 conversational endpoint and languages.
 * LiveKit's StreamAdapter performs sentence streaming and cancellation.
 */
export class ConversationalTTS extends tts.TTS {
  label = "arenal.ElevenLabsV3";
  constructor(private synthesizer: SpeechSynthesizer) {
    super(8000, 1, { streaming: false, alignedTranscript: false });
    // Provider completions can race session teardown, after SDK listeners detach.
    this.on("error", () => {});
  }
  synthesize(text: string, options?: APIConnectOptions, signal?: AbortSignal) {
    return new ConversationalStream(
      text,
      this,
      this.synthesizer,
      options,
      signal,
    );
  }
  stream(): tts.SynthesizeStream {
    throw new Error("Use the LiveKit sentence stream adapter");
  }
}
class ConversationalStream extends tts.ChunkedStream {
  label = "arenal.ElevenLabsV3Stream";
  constructor(
    text: string,
    private provider: tts.TTS,
    private synthesizer: SpeechSynthesizer,
    options?: APIConnectOptions,
    signal?: AbortSignal,
  ) {
    super(text, provider, options, signal);
  }
  async run() {
    const requestId = randomUUID();
    try {
      this.abortSignal.throwIfAborted();
      for await (const frame of this.synthesizer.synthesize(
        this.inputText,
        this.abortSignal,
      )) {
        this.abortSignal.throwIfAborted();
        const data = decodeMulaw(frame.data);
        this.queue.put({
          requestId,
          segmentId: requestId,
          frame: new AudioFrame(data, 8000, 1, data.length),
          final: false,
        });
      }
    } catch (error) {
      // ChunkedStream runs the producer in a background task. Never let a
      // normal barge-in/hangup become an unhandled rejection in that task.
      if (!this.abortSignal.aborted) {
        this.provider.emit("error", {
          type: "tts_error",
          timestamp: Date.now(),
          label: this.label,
          error: error instanceof SynthesisProviderError ? error : new Error("ElevenLabs synthesis failed"),
          recoverable: false,
        });
      }
    } finally {
      if (!this.queue.closed) this.queue.close();
    }
  }
}

/** Own the adapter so late errors still have a listener after AgentSession closes. */
export function safeStreamingTTS(provider: tts.TTS): tts.TTS {
  const streaming = provider.capabilities.streaming ? provider
    : new tts.StreamAdapter(provider, new tokenize.basic.SentenceTokenizer());
  streaming.on("error", () => {});
  return streaming;
}
