import { proposalSpeech } from "../../conversation/src/proposal-speech.js";
import { STT_LANGUAGE_OPTIONS, languageHint, languagePolicy, type SupportedLanguage } from "../../conversation/src/language.js";
import {
  initializeLogger,
  llm,
  voice,
  type VAD,
  type stt,
  type tts,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as silero from "@livekit/agents-plugin-silero";
import {
  TELEPHONE_AUDIO,
  type AudioFrame,
  type ConversationEngine,
  type EngineHost,
  type ToolDefinition,
} from "../../contracts/src/index.js";
import { instructions } from "../../conversation/src/engines.js";
import { ElevenLabsSynthesizer, SynthesisProviderError } from "./elevenlabs.js";
import { TelephoneInput, TelephoneOutput } from "./livekit-audio.js";
import { ConversationalTTS, safeStreamingTTS } from "./livekit-tts.js";

let vad: Promise<VAD> | undefined;
let logging = false;
export function initializeLiveKit() {
  if (!logging) {
    initializeLogger({ pretty: false, level: "warn" });
    logging = true;
  }
}
export type LiveKitOptions = {
  openaiKey: string;
  model: string;
  elevenlabsKey: string;
  voiceId: string;
};
export type LiveKitModels = {
  llm: llm.LLM;
  stt?: stt.STT;
  tts: tts.TTS;
  vad?: VAD;
};

/** Each call owns a session, input, output and tools. Only the stateless VAD model
 * is shared; Silero allocates independent state in each stream.
 */
export class LiveKitEngine implements ConversationEngine {
  readonly id = "livekit";
  readonly capabilities = {
    input: [TELEPHONE_AUDIO],
    output: [TELEPHONE_AUDIO],
    textInput: true,
    transcripts: true,
    tools: true,
    interrupt: true,
    turnDetection: "application" as const,
    languages: ["en", "es", "ca"],
  };
  private session?: voice.AgentSession;
  private input?: TelephoneInput;
  private output?: TelephoneOutput;
  private host?: EngineHost;
  private closed = false;
  private language?: SupportedLanguage;
  private lastTranscript = "";
  private lastTranscriptAt = 0;
  constructor(
    private options: LiveKitOptions,
    private models?: LiveKitModels,
  ) {}

  async start(host: EngineHost, definitions: ToolDefinition[]) {
    initializeLiveKit();
    this.host = host;
    const models = this.models ?? {
      llm: new openai.LLM({
        apiKey: this.options.openaiKey,
        model: this.options.model,
        parallelToolCalls: false,
        strictToolSchema: false,
        maxCompletionTokens: 1000,
        ...(this.options.model.startsWith("gpt-5")
          ? { reasoningEffort: "none" as const }
          : {}),
      }),
      stt: new elevenlabs.STT({
        apiKey: this.options.elevenlabsKey,
        model: "scribe_v2_realtime",
        sampleRate: 8000,
        includeTimestamps: true,
        ...STT_LANGUAGE_OPTIONS,
        serverVad: { vadSilenceThresholdSecs: 0.7 },
      }),
      tts: new ConversationalTTS(
        new ElevenLabsSynthesizer(
          this.options.elevenlabsKey,
          this.options.voiceId,
        ),
      ),
      vad: await (vad ??= silero.VAD.load({
        sampleRate: 8000,
        minSpeechDuration: 100,
        minSilenceDuration: 500,
      })),
    };
    const session = (this.session = new voice.AgentSession({
      ...models,
      tts: safeStreamingTTS(models.tts),
      maxToolSteps: 12,
      // Browser already requests echo cancellation; Prosper sends isolated caller audio.
      // SDK default would suppress the first 3 seconds of barge-in.
      aecWarmupDuration: 0,
      turnHandling: {
        turnDetection: models.vad ? "vad" : "manual",
        endpointing: { minDelay: 300, maxDelay: 1800 },
        interruption: {
          mode: "vad",
          enabled: true,
          minDuration: 350,
          minWords: 1,
          falseInterruptionTimeout: 1500,
          resumeFalseInterruption: true,
        },
        // Speculative tools must never change clinical state before a committed turn.
        preemptiveGeneration: { enabled: false },
      },
    }));
    this.input = new TelephoneInput();
    this.output = new TelephoneOutput(host);
    session.input.audio = this.input;
    session.output.audio = this.output;
    const engine = this;
    class Receptionist extends voice.Agent {
      async onUserTurnCompleted(
        _context: llm.ChatContext,
        message: llm.ChatMessage,
      ) {
        if (message.textContent) host.userText(message.textContent);
      }
      async llmNode(
        context: llm.ChatContext,
        tools: llm.ToolContext,
        settings: voice.ModelSettings,
      ) {
        const current = context.copy();
        current.items.unshift(
          llm.ChatMessage.create({
            role: "system",
            content:
              "Authoritative application state:\n" +
              host.context() +
              "\n" + languagePolicy(engine.language),
          }),
        );
        return super.llmNode(current, tools, settings);
      }
    }
    const agent = new Receptionist({
      instructions,
      tools: definitions.map((definition) =>
        llm.tool({
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
          flags: llm.ToolFlag.CANCELLABLE,
          execute: async (args, options) => {
            const result = await host.tool(definition.name, args, options.abortSignal);
            options.abortSignal?.throwIfAborted();
            const speech = proposalSpeech(definition.name, result, args);
            if (speech) {
              await session.say(speech, { allowInterruptions: true }).waitForPlayout();
              // The authoritative summary is now in chat history; no paraphrased tool reply.
              return undefined;
            }
            return result;
          },
        }),
      ),
    });
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (e) => {
      if (e.isFinal) engine.language = languageHint(engine.language, e.language, e.transcript);
      // Deduplicate diagnostic partials only, never genuine repeated user turns.
      if (e.isFinal || e.transcript !== engine.lastTranscript) {
        host.event("stt.transcript", {
          text: e.transcript,
          final: e.isFinal,
          language: e.language,
        });
        engine.lastTranscript = e.transcript;
      }
      if (e.isFinal) engine.lastTranscriptAt = performance.now();
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (e) => {
      if (
        e.item.type !== "message" ||
        e.item.role !== "assistant" ||
        !e.item.textContent
      )
        return;
      if (e.item.interrupted)
        host.event("assistant.interrupted", { text: e.item.textContent });
      else host.assistantText(e.item.textContent);
    });
    this.output.on(voice.AudioOutput.EVENT_PLAYBACK_STARTED, () => {
      host.event("latency.first_audio", {
        sinceTranscriptMs: engine.lastTranscriptAt
          ? Math.round(performance.now() - engine.lastTranscriptAt)
          : null,
      });
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e) =>
      host.event("agent.state", { state: e.newState }),
    );
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (e) =>
      host.event("user.state", { state: e.newState }),
    );
    session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, (e) =>
      host.event("interruption.false", { resumed: e.resumed }),
    );
    session.on(voice.AgentSessionEventTypes.UserTranscriptionTimeout, (e) => {
      host.event("stt.timeout", { speechDurationMs: e.speechDuration });
      // LiveKit's false-interruption recovery owns any paused answer; do not
      // start competing speech or re-run tools from a transcription timeout.
    });
    session.on(voice.AgentSessionEventTypes.Error, (e) =>
      host.event(e.error.recoverable ? "provider.retry" : "engine.error", {
        code: "error" in e.error && e.error.error instanceof SynthesisProviderError ? e.error.error.code : e.error.type,
      }),
    );
    await session.start({ agent, record: false });
    if (this.closed) await session.close();
    host.event("engine.ready", {
      engine: "livekit",
      interruptions: "local-vad",
      resumableAudio: true,
    });
  }
  async acceptAudio(frame: AudioFrame) {
    if (!this.closed) this.input!.push(frame);
  }
  async acceptText(text: string) {
    if (this.closed || !this.session) throw new Error("LiveKit session closed");
    this.host!.userText(text);
    await this.session.generateReply({ userInput: text }).waitForPlayout();
  }
  async interrupt() {
    if (this.session && !this.closed) await this.session.interrupt().await;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.output?.clearBuffer();
    await this.session?.close();
    await this.input?.close();
  }
}
