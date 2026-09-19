import { Laminar, LaminarSpanProcessor, getTracerProvider } from "@lmnr-ai/lmnr";
import { telemetry } from "@livekit/agents";
import type { ConversationEngine, EngineHost, ToolDefinition, AudioFrame } from "../../contracts/src/index.js";

let enabled = false;
/** One provider: LiveKit supplies native LLM/STT/TTS spans; no duplicate SDK patches. */
export function initializeTracing(key = process.env.LMNR_PROJECT_API_KEY): boolean {
  if (enabled || !key) return enabled;
  const exporter = new LaminarSpanProcessor({ apiKey: key });
  const filters: telemetry.SpanProcessorLike[] = [];
  Laminar.initialize({
    projectApiKey: key,
    instrumentModules: {},
    logLevel: "error",
    spanProcessor: {
      onStart: (span, context) => exporter.onStart(span, context),
      onEnd: (span) => {
        // Laminar owns the provider. Run LiveKit's privacy filter before its exporter,
        // including on SDK versions where the processor has no onEnding hook.
        for (const filter of filters) filter.onEnding?.(span as never);
        exporter.onEnd(span);
      },
      forceFlush: () => exporter.forceFlush(),
      shutdown: () => exporter.shutdown(),
    },
  });
  telemetry.setTracerProvider(getTracerProvider(), {
    allowPii: false,
    registerSpanProcessor: (processor) => { filters.push(processor); },
  });
  enabled = true;
  return true;
}
export async function flushTracing() {
  if (enabled) await Laminar.flush();
}
export function traceEngine(engine: ConversationEngine): ConversationEngine {
  return enabled ? new TracedEngine(engine) : engine;
}

/** Explicit per-call context keeps concurrent WebSocket callbacks isolated. */
export class TracedEngine implements ConversationEngine {
  private span?: ReturnType<typeof Laminar.startSpan>;
  get id() { return this.inner.id; }
  get capabilities() { return this.inner.capabilities; }
  constructor(private readonly inner: ConversationEngine) {}
  private within<T>(fn: () => T): T {
    return this.span ? Laminar.withSpan(this.span, fn, false) : fn();
  }
  async start(host: EngineHost, tools: ToolDefinition[]) {
    const { callId } = JSON.parse(host.context()) as { callId: string };
    this.span = Laminar.startSpan({ name: "clinic.call", sessionId: callId,
      tags: ["voice", this.id], metadata: { engine: this.id, contentCapture: false } });
    const allowed = new Set(tools.map(tool => tool.name));
    try {
      await this.within(() => this.inner.start({ ...host,
        tool: (name, args, signal) => this.within(async () => {
          const tool = Laminar.startSpan({ name: `clinic.${allowed.has(name) ? name : "unknown_tool"}`, spanType: "TOOL" });
          try {
            return await Laminar.withSpan(tool, async () => {
              const result = await host.tool(name, args, signal);
              Laminar.setSpanOutput({ ok: result.ok });
              tool.setAttribute("clinic.tool.ok", result.ok);
              return result;
            }, false);
          } catch (error) {
            tool.setStatus({ code: 2, message: "Tool failed (details omitted)" });
            throw error;
          } finally { tool.end(); }
        }),
        event: (type, data) => {
          if (["audio.paused", "audio.resumed", "latency.first_audio", "interruption.false", "stt.timeout", "provider.retry", "assistant.interrupted", "engine.ready", "engine.error"].includes(type)) {
            const ms = (data as { sinceTranscriptMs?: unknown } | undefined)?.sinceTranscriptMs;
            this.span?.addEvent(type, type === "latency.first_audio" && typeof ms === "number"
              ? { sinceTranscriptMs: ms } : undefined); // Never attach patient speech.
          }
          host.event(type, data);
        },
      }, tools));
    } catch (error) {
      this.span.setStatus({ code: 2, message: "Call startup failed (details omitted)" });
      this.span.end();
      throw error;
    }
  }
  acceptAudio(frame: AudioFrame) { return this.within(() => this.inner.acceptAudio(frame)); }
  acceptText(text: string) { return this.within(() => this.inner.acceptText(text)); }
  interrupt() { return this.within(() => this.inner.interrupt()); }
  async close() {
    try { await this.within(() => this.inner.close()); }
    finally { this.span?.end(); this.span = undefined; }
  }
}
