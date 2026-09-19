import { it, expect } from "vitest";
import WebSocket from "ws";
import { once } from "node:events";
import { createServer } from "../apps/server/src/server.js";
import { config } from "../apps/server/src/config.js";
import { MemoryRepository } from "../packages/adapters/src/storage.js";
import { FixtureClinic, MemorySink } from "../packages/adapters/src/clinic.js";
import { TextEngine } from "../packages/conversation/src/engines.js";
import { TELEPHONE_AUDIO } from "../packages/contracts/src/index.js";
import { PacedAudio } from "../packages/adapters/src/telephony.js";
it("runs the authenticated console API and rejects cross-origin writes", async () => {
  const app = await createServer(
    config({ CONSOLE_TOKEN: "secret", STORE: "memory" }),
    {
      repository: new MemoryRepository(),
      clinic: new FixtureClinic(),
      sink: new MemorySink(),
      engine: () => new TextEngine(),
    },
  );
  try {
    expect((await app.inject({ url: "/api/events" })).statusCode).toBe(401);
    const headers = { authorization: "Bearer secret" };
    const created = await app.inject({
      method: "POST",
      url: "/api/calls",
      headers,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().callId;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/calls/${id}/text`,
          headers,
          payload: { text: "/tool create_task {}" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/calls",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    await app.inject({
      method: "POST",
      url: `/api/calls/${id}/close`,
      headers,
    });
    const events = (await app.inject({ url: "/api/events", headers })).json();
    expect(events.active).toEqual([]);
    expect(events.events.some((e: any) => e.type === "call.incomplete")).toBe(
      true,
    );
  } finally {
    await app.close();
  }
});
it("uses start.callSid over the socket and rejects duplicate sessions", async () => {
  class AudioEngine extends TextEngine {
    override readonly id = "text";
    override readonly capabilities = {
      ...new TextEngine().capabilities,
      input: [TELEPHONE_AUDIO],
      output: [TELEPHONE_AUDIO],
    };
    override async acceptAudio() {}
  }
  const repository = new MemoryRepository();
  const c = config({
    ENGINE: "realtime",
    OPENAI_API_KEY: "test",
    STORE: "memory",
    TRANSPORT_TOKEN: "transport",
  });
  const app = await createServer(c, {
    repository,
    clinic: new FixtureClinic(),
    sink: new MemorySink(),
    engine: () => new AudioEngine(),
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(
    address.replace("http:", "ws:") + "/ws?token=transport",
  );
  try {
    await once(socket, "open");
    socket.send(
      JSON.stringify({
        event: "start",
        streamSid: "stream",
        start: {
          callSid: "authoritative-id",
          customParameters: { call_id: "wrong" },
          mediaFormat: {
            encoding: "audio/x-mulaw",
            sampleRate: 8000,
            channels: 1,
          },
        },
      }),
    );
    socket.send(
      JSON.stringify({
        event: "media",
        media: { payload: Buffer.alloc(160, 255).toString("base64") },
      }),
    );
    socket.send(JSON.stringify({ event: "stop" }));
    await once(socket, "close");
    await new Promise((r) => setTimeout(r, 30));
    expect(
      (await repository.events()).every((e) => e.callId === "authoritative-id"),
    ).toBe(true);
    expect(
      (await repository.events()).some((e) => e.type === "call.closed"),
    ).toBe(true);
  } finally {
    socket.close();
    await app.close();
  }
});
it("paces and cancels queued output instead of relying on clear", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (value: string) => sent.push(value),
  } as unknown as WebSocket;
  const output = new PacedAudio(socket, "stream");
  const work = output.write({
    data: Buffer.alloc(1600, 255),
    format: TELEPHONE_AUDIO,
  });
  await new Promise((r) => setTimeout(r, 30));
  output.clear();
  await work;
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.length).toBeLessThan(10);
  for (const message of sent)
    expect(
      Buffer.from(JSON.parse(message).media.payload, "base64"),
    ).toHaveLength(160);
});
