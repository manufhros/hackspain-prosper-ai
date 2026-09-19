import { it, expect } from "vitest";
import { AudioFrame } from "@livekit/rtc-node";
import { voice } from "@livekit/agents";
import {
  TelephoneOutput,
  decodeMulaw,
  encodeMulaw,
} from "../packages/adapters/src/livekit-audio.js";
import {
  LiveKitEngine,
  initializeLiveKit,
} from "../packages/adapters/src/livekit.js";
import { ConversationalTTS, safeStreamingTTS } from "../packages/adapters/src/livekit-tts.js";
import {
  TELEPHONE_AUDIO,
  type EngineHost,
} from "../packages/contracts/src/index.js";

initializeLiveKit();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pcm = (ms: number) =>
  new AudioFrame(new Int16Array(ms * 8).fill(1000), 8000, 1, ms * 8);
function harness() {
  const packets: number[] = [],
    events: { type: string; data?: any }[] = [],
    answers: string[] = [],
    users: string[] = [];
  const host: EngineHost = {
    userText: (t) => users.push(t),
    assistantText: (t) => answers.push(t),
    audio: async (f) => {
      packets.push(f.data.length);
      await delay(f.data.length / 8);
    },
    interrupt: () => events.push({ type: "clear" }),
    event: (type, data) => events.push({ type, data }),
    context: () => "{}",
    tool: async () => ({ ok: true }),
  };
  return { host, packets, events, answers, users };
}
it("round trips telephone PCM without polarity inversion or amplitude saturation", () => {
  const input = Int16Array.from([-30000, -1000, 0, 1000, 30000]);
  const output = decodeMulaw(encodeMulaw(input));
  input.forEach((value, i) =>
    expect(Math.abs(output[i]! - value)).toBeLessThan(700),
  );
});
it("pauses mid-frame, preserves the tail, and resumes without replaying it", async () => {
  const h = harness(),
    output = new TelephoneOutput(h.host);
  const write = output.captureFrame(pcm(200));
  await delay(35);
  output.pause();
  const count = h.packets.length;
  await delay(70);
  expect(h.packets).toHaveLength(count);
  expect(h.events.some((e) => e.type === "clear")).toBe(false);
  output.resume();
  await write;
  output.flush();
  expect((await output.waitForPlayout()).interrupted).toBe(false);
  expect(h.packets.reduce((a, b) => a + b, 0)).toBe(1600);
});
it("cancels a paused segment and accepts a new response without deadlock or stale audio", async () => {
  const h = harness(),
    output = new TelephoneOutput(h.host);
  const old = output.captureFrame(pcm(500));
  await delay(35);
  output.pause();
  output.clearBuffer();
  await old;
  expect((await output.waitForPlayout()).interrupted).toBe(true);
  const count = h.packets.length;
  await output.captureFrame(pcm(40));
  output.flush();
  const end = await output.waitForPlayout();
  expect(end.interrupted).toBe(false);
  expect(end.playbackPosition).toBeCloseTo(0.04);
  expect(h.packets.length - count).toBe(2);
});
it("does not count a cancelled frame waiting at a pause gate as a played segment", async () => {
  const h = harness(),
    output = new TelephoneOutput(h.host);
  output.pause();
  const blocked = output.captureFrame(pcm(100));
  await delay(5);
  output.clearBuffer();
  await blocked;
  expect(h.packets).toHaveLength(0);
  expect(output.pendingPlayoutSegments).toBe(0);
  await output.captureFrame(pcm(20));
  output.flush();
  expect((await output.waitForPlayout()).interrupted).toBe(false);
});
it("runs real LiveKit session orchestration and recovers after an interrupted reply", async () => {
  const h = harness();
  const engine = new LiveKitEngine(
    { openaiKey: "", model: "test", elevenlabsKey: "", voiceId: "" },
    {
      llm: new voice.testing.FakeLLM([
        {
          input: "Hola",
          content: "Buenos días. Dígame en qué le puedo ayudar.",
        },
        { input: "Quiero cancelar", content: "Vamos a revisar su cita." },
      ]),
      tts: new ConversationalTTS({
        async *synthesize(_text, signal) {
          for (let i = 0; i < 30; i++) {
            signal.throwIfAborted();
            yield {
              data: new Uint8Array(160).fill(255),
              format: TELEPHONE_AUDIO,
            };
          }
        },
      }),
    },
  );
  try {
    await engine.start(h.host, []);
    const first = engine.acceptText("Hola");
    for (let i = 0; i < 150 && !h.packets.length; i++) await delay(10);
    expect(h.packets.length).toBeGreaterThan(0);
    await engine.interrupt();
    await first;
    const before = h.packets.length;
    await engine.acceptText("Quiero cancelar");
    expect(h.packets.length).toBeGreaterThan(before);
    expect(h.answers.at(-1)).toBe("Vamos a revisar su cita.");
    expect(h.users).toEqual(["Hola", "Quiero cancelar"]);
    expect(h.answers).not.toContain(
      "Buenos días. Dígame en qué le puedo ayudar.",
    );
    expect(h.events.some((e) => e.type === "engine.error")).toBe(false);
  } finally {
    await engine.close();
  }
}, 15000);

it("LiveKit automatically resumes a false VAD interruption without generating another reply", async () => {
  const { VAD, VADStream, VADEventType, stt } = await import("@livekit/agents");
  const { ReadableStream } = await import("node:stream/web");
  class ScriptedStream extends VADStream {
    constructor(v: InstanceType<typeof VAD>) {
      super(v);
      void (async () => {
        try {
          while (!this.closed) {
            if ((await this.inputReader.read()).done) break;
          }
        } catch {}
      })();
    }
    speech(type: (typeof VADEventType)[keyof typeof VADEventType]) {
      this.sendVADEvent({
        type,
        samplesIndex: 0,
        timestamp: Date.now(),
        speechDuration: 500,
        silenceDuration: type === VADEventType.END_OF_SPEECH ? 500 : 0,
        frames: [],
        probability: 1,
        inferenceDuration: 0,
        speaking: type !== VADEventType.END_OF_SPEECH,
        rawAccumulatedSilence: 0,
        rawAccumulatedSpeech: 500,
      });
    }
  }
  class ScriptedVAD extends VAD {
    label = "test-vad";
    current?: ScriptedStream;
    constructor() {
      super({ updateInterval: 32 });
    }
    stream() {
      return (this.current = new ScriptedStream(this));
    }
  }
  const h = harness(),
    vad = new ScriptedVAD();
  const session = new voice.AgentSession({
    aecWarmupDuration: 0,
    transcriptionTimeout: 200,
    stt: new stt.testing.FakeSTT({ fakeUserSpeeches: [] }),
    vad,
    llm: new voice.testing.FakeLLM(),
    turnHandling: {
      turnDetection: "vad",
      interruption: {
        mode: "vad",
        minDuration: 100,
        minWords: 0,
        falseInterruptionTimeout: 100,
        resumeFalseInterruption: true,
      },
      preemptiveGeneration: { enabled: false },
    },
  });
  const { TelephoneInput } = await import(
    "../packages/adapters/src/livekit-audio.js"
  );
  const input = new TelephoneInput();
  session.input.audio = input;
  session.output.audio = new TelephoneOutput(h.host);
  let resumed = false;
  session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, (e) => {
    resumed = e.resumed;
  });
  try {
    await session.start({
      agent: new voice.Agent({ instructions: "Test" }),
      record: false,
    });
    const audio = new ReadableStream<AudioFrame>({
      start(c) {
        for (let i = 0; i < 30; i++) c.enqueue(pcm(20));
        c.close();
      },
    });
    const handle = session.say("Test resumable audio", { audio });
    for (let i = 0; i < 100 && !h.packets.length; i++) await delay(10);
    expect(h.packets.length).toBeGreaterThan(0);
    vad.current!.speech(VADEventType.START_OF_SPEECH);
    vad.current!.speech(VADEventType.INFERENCE_DONE);
    for (
      let i = 0;
      i < 100 && !h.events.some((e) => e.type === "audio.paused");
      i++
    )
      await delay(10);
    expect(h.events.some((e) => e.type === "audio.paused")).toBe(true);
    vad.current!.speech(VADEventType.END_OF_SPEECH);
    await handle.waitForPlayout();
    expect(resumed).toBe(true);
    expect(h.events.some((e) => e.type === "audio.resumed")).toBe(true);
    expect(h.packets.reduce((a, b) => a + b, 0)).toBe(4800);
  } finally {
    await session.close();
    await input.close();
  }
}, 10000);

it("routes LiveKit function calls through the existing gateway with an abort signal", async () => {
  const h = harness();
  let called = false;
  h.host.tool = async (name, args, signal) => {
    expect(name).toBe("create_task");
    expect(args).toEqual({});
    expect(signal).toBeInstanceOf(AbortSignal);
    called = true;
    return { ok: true, data: { task_id: "demo" } };
  };
  const engine = new LiveKitEngine(
    { openaiKey: "", model: "test", elevenlabsKey: "", voiceId: "" },
    {
      llm: new voice.testing.FakeLLM([
        {
          input: "Quiero cita",
          toolCalls: [{ name: "create_task", args: {} }],
        },
        {
          input: '{"ok":true,"data":{"task_id":"demo"}}',
          content: "¿Cuál es su DNI?",
        },
      ]),
      tts: new ConversationalTTS({
        async *synthesize() {
          yield {
            data: new Uint8Array(160).fill(255),
            format: TELEPHONE_AUDIO,
          };
        },
      }),
    },
  );
  try {
    await engine.start(h.host, [
      {
        name: "create_task",
        description: "Create task",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
    await engine.acceptText("Quiero cita");
    expect(called).toBe(true);
    expect(h.answers).toEqual(["¿Cuál es su DNI?"]);
  } finally {
    await engine.close();
  }
}, 10000);

it("treats TTS cancellation during provider streaming as normal completion, without an unhandled rejection", async () => {
  let cancelled = false;
  const errors: unknown[] = [];
  const tts = new ConversationalTTS({
    async *synthesize(_text, signal) {
      yield { data: new Uint8Array(160).fill(255), format: TELEPHONE_AUDIO };
      await new Promise<void>((_resolve, reject) => {
        const abort = () => {
          cancelled = true;
          reject(new Error("Aborted"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    },
  });
  tts.on("error", (e) => errors.push(e));
  const stream = tts.synthesize("A long response");
  expect((await stream.next()).done).toBe(false);
  stream.close();
  expect((await stream.next()).done).toBe(true);
  await delay(30);
  expect(cancelled).toBe(true);
  expect(errors).toEqual([]);
});
it("surfaces real TTS failures as provider errors instead of crashing the process", async () => {
  const errors: unknown[] = [];
  const tts = new ConversationalTTS({
    async *synthesize() {
      throw new Error("Network failure");
    },
  });
  tts.on("error", (e) => errors.push(e));
  expect((await tts.synthesize("Hello").next()).done).toBe(true);
  expect(errors).toHaveLength(1);
});

it("speaks the authoritative proposal through LiveKit without a paraphrased model reply", async () => {
  const h = harness();
  const summary = "Dr. Test, centro, September 21, 2026 at 09:15, insurance asisa.";
  h.host.tool = async () => ({ ok: true, data: { summary, confirmed: false } });
  const spoken: string[] = [];
  const engine = new LiveKitEngine(
    {openaiKey:"",model:"test",elevenlabsKey:"",voiceId:""},
    {llm: new voice.testing.FakeLLM([{input:"The first slot please",toolCalls:[{name:"propose_booking",args:{language:"en"}}]}]),
      tts:new ConversationalTTS({async *synthesize(text){spoken.push(text);yield {data:new Uint8Array(160).fill(255),format:TELEPHONE_AUDIO};}})},
  );
  try {
    await engine.start(h.host,[{name:"propose_booking",description:"Propose",parameters:{type:"object",properties:{language:{type:"string"}},required:["language"]}}]);
    await engine.acceptText("The first slot please");
    for(let i=0;i<200 && !h.answers.length;i++)await delay(10);
    expect(h.answers.join(" ")).toContain(summary);
    expect(h.answers.join(" ")).toContain("Do you confirm");
    expect(spoken.join(" ")).toContain("insurance asisa");
  } finally {await engine.close();}
},10000);

it("survives the logged late TTS error after session listeners detach", async () => {
  const provider = new ConversationalTTS({async *synthesize(){throw Error("Network failure after close");}});
  const adapter = safeStreamingTTS(provider);
  // No AgentSession error listener: reproduces the previous ERR_UNHANDLED_ERROR path.
  expect((await adapter.synthesize("Late chunk").next()).done).toBe(true);
  await adapter.close();
  expect((await provider.synthesize("Later chunk").next()).done).toBe(true);
});
