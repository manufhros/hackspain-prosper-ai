import { it, expect } from "vitest";
import WebSocket from "ws";
import { once } from "node:events";
import { encodeMulaw, decodeMulaw } from "../apps/console/src/audio-codec.js";
import { createServer } from "../apps/server/src/server.js";
import { config } from "../apps/server/src/config.js";
import { MemoryRepository } from "../packages/adapters/src/storage.js";
import { FixtureClinic, MemorySink } from "../packages/adapters/src/clinic.js";
import { TextEngine } from "../packages/conversation/src/engines.js";
import {
  TELEPHONE_AUDIO,
  type EngineHost,
} from "../packages/contracts/src/index.js";
it("encodes G.711 silence and preserves polarity and level within quantisation", () => {
  const pcm = new Float32Array([0, 0.1, -0.1, 0.5, -0.5, 1, -1]);
  const encoded = encodeMulaw(pcm);
  expect(encoded[0]).toBe(255);
  const decoded = decodeMulaw(encoded);
  for (let i = 0; i < pcm.length; i++)
    expect(Math.abs(decoded[i]! - pcm[i]!)).toBeLessThan(0.03);
});
it("requires a console ticket, consumes it once, and isolates browser actions from Prosper", async () => {
  let finishAction!: () => void;
  const acted = new Promise<void>((r) => {
    finishAction = r;
  });
  class AudioEngine extends TextEngine {
    override readonly capabilities = {
      ...new TextEngine().capabilities,
      input: [TELEPHONE_AUDIO],
      output: [TELEPHONE_AUDIO],
    };
    private output!: EngineHost;
    override async start(host: EngineHost) {
      this.output = host;
    }
    override async acceptAudio() {
      const t = await this.output.tool("create_task", {});
      await this.output.tool("conclude", {
        task_id: (t.data as { task_id: string }).task_id,
        action: "NO_ACTION",
        reason: "out_of_scope",
      });
      finishAction();
    }
  }
  const repository = new MemoryRepository(),
    sink = new MemorySink();
  const app = await createServer(
    config({
      ENGINE: "pipeline",
      CLINIC: "prosper",
      PLATFORM_API_KEY: "test",
      TRANSPORT_TOKEN: "test",
      CONSOLE_TOKEN: "console",
      OPENAI_API_KEY: "test",
      ELEVENLABS_API_KEY: "test",
      ELEVENLABS_VOICE_ID: "test",
      STORE: "memory",
    }),
    {
      repository,
      clinic: new FixtureClinic(),
      sink,
      engine: () => new AudioEngine(),
    },
  );
  let socket: WebSocket | undefined;
  try {
    expect(
      (await app.inject({ method: "POST", url: "/api/voice-ticket" }))
        .statusCode,
    ).toBe(401);
    const ticket = (
      await app.inject({
        method: "POST",
        url: "/api/voice-ticket",
        headers: { authorization: "Bearer console" },
      })
    ).json().ticket;
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const url =
      address.replace("http:", "ws:") + "/ws/browser?ticket=" + ticket;
    socket = new WebSocket(url);
    const [raw] = await once(socket, "message");
    expect(JSON.parse(raw.toString()).type).toBe("ready");
    const reused = new WebSocket(url);
    const response = await new Promise<number>((resolve) => {
      reused.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode!);
        res.resume();
        reused.terminate();
      });
      reused.on("error", () => {});
    });
    expect(response).toBe(401);
    socket.send(Buffer.alloc(160, 255));
    await acted;
    socket.close();
    await once(socket, "close");
    for (let i = 0; i < 30; i++) {
      if ((await repository.events()).some((e) => e.type === "delivery.result"))
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await repository.events()).some((e) => e.type === "call.lab")).toBe(
      true,
    );
    expect(
      (await repository.events()).some((e) => e.type === "delivery.result"),
    ).toBe(true);
    expect(sink.records.size).toBe(0);
    expect(await repository.deliveries()).toEqual([]);
  } finally {
    socket?.close();
    await app.close();
  }
});

it("resamples continuous 44.1 and 48 kHz capture into 20 ms frames", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const script = await readFile(
    "apps/console/public/microphone-worklet.js",
    "utf8",
  );
  for (const sampleRate of [44100, 48000]) {
    const frames: Float32Array[] = [];
    let Capture: any;
    runInNewContext(script, {
      sampleRate,
      Float32Array,
      AudioWorkletProcessor: class {
        port = { postMessage: (f: Float32Array) => frames.push(f) };
      },
      registerProcessor: (_name: string, ctor: any) => {
        Capture = ctor;
      },
    });
    const capture = new Capture();
    for (let i = 0; i < sampleRate; i += 128)
      capture.process([
        [new Float32Array(Math.min(128, sampleRate - i)).fill(0.25)],
      ]);
    expect(frames).toHaveLength(50);
    for (const frame of frames) {
      expect(frame.length).toBe(160);
      expect(frame[0]).toBeCloseTo(0.25);
    }
  }
});
