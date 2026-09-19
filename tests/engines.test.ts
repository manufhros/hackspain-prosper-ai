import { it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { RealtimeEngine } from "../packages/adapters/src/realtime.js";
import { PipelineEngine } from "../packages/conversation/src/engines.js";
import { CallRuntime } from "../packages/runtime/src/session.js";
import { DeliveryService } from "../packages/runtime/src/delivery.js";
import { FixtureClinic, MemorySink } from "../packages/adapters/src/clinic.js";
import { MemoryRepository } from "../packages/adapters/src/storage.js";
import type {
  EngineHost,
  LanguageModel,
} from "../packages/contracts/src/index.js";
it("swaps the text engine for an LLM pipeline without changing the tool gateway", async () => {
  let n = 0;
  const model: LanguageModel = {
    complete: async () =>
      ++n === 1
        ? {
            text: "",
            calls: [
              {
                id: "tool",
                type: "function",
                function: { name: "create_task", arguments: "{}" },
              },
            ],
          }
        : { text: "¿En qué puedo ayudarte?", calls: [] },
  };
  const repo = new MemoryRepository(),
    sink = new MemorySink();
  const runtime = new CallRuntime(
    new PipelineEngine(model),
    new FixtureClinic(),
    repo,
    new DeliveryService(repo, sink),
    "pipeline",
    new Date(),
    () => {},
  );
  await runtime.start();
  await runtime.text("Hola");
  expect(runtime.session.tasks.size).toBe(1);
  await runtime.close();
  expect((await repo.events()).some((e) => e.type === "assistant.text")).toBe(
    true,
  );
  expect(sink.records.size).toBe(0);
});
it("native adapter configures audio and routes function results through the host", async () => {
  class Socket extends EventEmitter {
    readyState = 1;
    sent: any[] = [];
    send(raw: string) {
      const e = JSON.parse(raw);
      this.sent.push(e);
      if (e.type === "session.update")
        queueMicrotask(() =>
          this.emit("message", Buffer.from('{"type":"session.updated"}')),
        );
    }
    close() {
      this.readyState = 3;
    }
  }
  const socket = new Socket();
  let heard = "";
  const called: string[] = [];
  const host: EngineHost = {
    userText: (text) => {
      heard = text;
    },
    assistantText: () => {},
    audio: async () => {},
    interrupt: () => {},
    tool: async (name) => {
      called.push(name);
      return { ok: true, data: { task_id: "t" } };
    },
    context: () => "{}",
    event: () => {},
  };
  const engine = new RealtimeEngine("test", "test-model", () => {
    queueMicrotask(() => socket.emit("open"));
    return socket as unknown as WebSocket;
  });
  await engine.start(host, []);
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ type: "response.created", response: { id: "r1" } }),
    ),
  );
  expect(socket.sent[0].session.audio.input.format.type).toBe("audio/pcmu");
  expect(
    socket.sent[0].session.audio.input.turn_detection.create_response,
  ).toBe(false);
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Hola",
      }),
    ),
  );
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "r1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "f",
              name: "create_task",
              arguments: "{}",
            },
          ],
        },
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 0));
  expect(heard).toBe("Hola");
  expect(called).toEqual(["create_task"]);
  expect(socket.sent.some((e) => e.item?.type === "function_call_output")).toBe(
    true,
  );
  await engine.close();
});

it("does not execute late native tool calls from an interrupted response", async () => {
  class Socket extends EventEmitter {
    readyState = 1;
    send(raw: string) {
      if (JSON.parse(raw).type === "session.update")
        queueMicrotask(() =>
          this.emit("message", Buffer.from('{"type":"session.updated"}')),
        );
    }
    close() {}
  }
  const socket = new Socket();
  let calls = 0;
  const host: EngineHost = {
    userText: () => {},
    assistantText: () => {},
    audio: async () => {},
    interrupt: () => {},
    tool: async () => {
      calls++;
      return { ok: true };
    },
    context: () => "{}",
    event: () => {},
  };
  const engine = new RealtimeEngine("test", "test", () => {
    queueMicrotask(() => socket.emit("open"));
    return socket as unknown as WebSocket;
  });
  await engine.start(host, []);
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ type: "response.created", response: { id: "old" } }),
    ),
  );
  await engine.interrupt();
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "old",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "f",
              name: "confirm_proposal",
              arguments: "{}",
            },
          ],
        },
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(0);
  await engine.close();
});
