import { expect, test } from "bun:test";
import { CallerWire } from "../src/simulation/call";
import { MonitorFeed } from "../src/simulation/playback";

const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

test("monitor gets actual caller frames as sent and receptionist frames before the playback mark", () => {
  const heard: { role: string; audio: Buffer }[] = [];
  const wire = new CallerWire("workbench-test", "MS-test", () => {}, (role, audio) => heard.push({ role, audio }));
  wire.start(); wire.play(Buffer.alloc(321, 0x81));
  expect(heard).toEqual([]); // No premature playback of the entire synthesized utterance.
  wire.tick(); expect(heard).toEqual([{ role: "caller", audio: Buffer.alloc(160, 0x81) }]);
  wire.receive({ event: "media", streamSid: "MS-test", media: { payload: Buffer.alloc(160, 0x82).toString("base64") } });
  expect(heard[1]).toEqual({ role: "agent", audio: Buffer.alloc(160, 0x82) });
  wire.receive({ event: "mark", streamSid: "MS-test", mark: { name: "done" } });
  expect(heard).toHaveLength(2); // Completion marks never replay an already heard turn.
  wire.tick(); wire.tick(); wire.tick();
  expect(heard[3]!.audio).toEqual(Buffer.concat([Buffer.from([0x81]), Buffer.alloc(159, 0xff)]));
  expect(heard[4]!.audio).toEqual(Buffer.alloc(160, 0xff));
});

test("slow speaker pipe never blocks the call and drops old queued monitor frames", async () => {
  const written: number[] = [];
  let unblock!: () => void;
  const paused = new Promise<void>(resolve => { unblock = resolve; });
  const feed = new MonitorFeed(async line => {
    written.push(Buffer.from(JSON.parse(line).payload, "base64")[0]!);
    await paused;
  }, () => { throw new Error("Unexpected speaker failure"); });
  for (let i = 0; i < 100; i++) feed.push("caller", Buffer.alloc(160, i));
  expect(written).toEqual([0]);
  unblock(); await settle();
  expect(written).toEqual([0, ...Array.from({ length: 20 }, (_, i) => i + 80)]);
  feed.stop(); feed.push("caller", Buffer.alloc(160, 127)); await settle();
  expect(written).toHaveLength(21);
});

test("speaker failure disables only playback and emits one warning", async () => {
  let warnings = 0, writes = 0;
  const feed = new MonitorFeed(async () => { writes++; throw new Error("Device disconnected"); }, () => { warnings++; });
  feed.push("agent", Buffer.alloc(160, 0x81)); await settle();
  feed.push("caller", Buffer.alloc(160, 0x82)); await settle();
  expect(writes).toBe(1); expect(warnings).toBe(1);
});
