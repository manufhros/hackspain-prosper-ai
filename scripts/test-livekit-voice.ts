/** Opt-in paid provider test. Synthetic clinic only; never submits to Prosper. */
import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { config, engineFactory } from "../apps/server/src/config.js";
import { ElevenLabsSynthesizer } from "../packages/adapters/src/elevenlabs.js";
import { CallRuntime } from "../packages/runtime/src/session.js";
import { FixtureClinic, MemorySink } from "../packages/adapters/src/clinic.js";
import { MemoryRepository } from "../packages/adapters/src/storage.js";
import { DeliveryService } from "../packages/runtime/src/delivery.js";
import {
  TELEPHONE_AUDIO,
  type DomainEvent,
} from "../packages/contracts/src/index.js";
import assert from "node:assert/strict";

const c = config({
  ...process.env,
  ENGINE: "livekit",
  CLINIC: "fixture",
  STORE: "memory",
});
const events: DomainEvent[] = [];
const synthesizer = new ElevenLabsSynthesizer(
  c.ELEVENLABS_API_KEY,
  c.ELEVENLABS_VOICE_ID,
);
const repo = new MemoryRepository(),
  sink = new MemorySink();
const call = new CallRuntime(
  engineFactory(c)(),
  new FixtureClinic(),
  repo,
  new DeliveryService(repo, sink),
  "livekit-interruption-smoke-" + Date.now(),
  new Date(),
  (e) => {
    events.push(e);
    if (
      [
        "user.text",
        "assistant.text",
        "assistant.interrupted",
        "audio.paused",
        "audio.resumed",
        "engine.error",
        "latency.first_audio",
      ].includes(e.type)
    )
      console.log(JSON.stringify({ at: e.at, type: e.type, data: e.data }));
  },
  async (frame) => {
    await delay(frame.data.length / 8);
  },
);
async function speech(text: string) {
  const chunks: Buffer[] = [];
  for await (const frame of synthesizer.synthesize(
    text,
    AbortSignal.timeout(20000),
  ))
    chunks.push(Buffer.from(frame.data));
  return Buffer.concat(chunks);
}
async function until(predicate: () => boolean, timeout = 25000) {
  const start = Date.now();
  while (!predicate()) {
    assert(
      !events.some((e) => e.type === "engine.error"),
      "Voice engine error",
    );
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for voice event");
    await delay(20);
  }
}
let stop = false;
let feed: Promise<void> | undefined;
const queue: Buffer[] = [];
function enqueue(bytes: Buffer) {
  for (let i = 0; i < bytes.length; i += 160) {
    const frame = Buffer.alloc(160, 255);
    bytes.copy(frame, 0, i, Math.min(i + 160, bytes.length));
    queue.push(frame);
  }
}
try {
  const greeting = await speech(
    "Hola, buenos días. Quiero pedir una cita de medicina general.",
  );
  const correction = await speech(
    "Espera, no. Háblame en inglés. Quiero pedir una cita.",
  );
  const followup = await speech("Can you hear me?");
  await call.start(true);
  feed = (async () => {
    while (!stop) {
      await call.audio({
        data: queue.shift() ?? Buffer.alloc(160, 255),
        format: TELEPHONE_AUDIO,
      });
      await delay(20);
    }
  })();
  enqueue(greeting);
  await until(() => events.some((e) => e.type === "latency.first_audio"));
  await delay(700);
  enqueue(correction);
  await until(() =>
    events.some(
      (e) => e.type === "audio.paused" || e.type === "audio.interrupted",
    ),
  );
  await until(() => events.some((e) => e.type === "assistant.interrupted"));
  await until(() => events.some((e) => e.type === "assistant.text"));
  const responses = events.filter((e) => e.type === "assistant.text").length;
  enqueue(followup);
  await until(
    () => events.filter((e) => e.type === "assistant.text").length > responses,
  );
  assert.equal(sink.records.size, 0);
  console.log(
    "PASS: real audio interruption, next reply, and following turn recovered; no Prosper submission.",
  );
} finally {
  stop = true;
  await feed;
  await call.close();
}
