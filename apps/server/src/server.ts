import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  Repository,
  ClinicDataSource,
  ActionSink,
  ConversationEngine,
} from "../../../packages/contracts/src/index.js";
import { TELEPHONE_AUDIO } from "../../../packages/contracts/src/index.js";
import { CallRuntime } from "../../../packages/runtime/src/session.js";
import { DeliveryService } from "../../../packages/runtime/src/delivery.js";
import {
  PacedAudio,
  startSchema,
} from "../../../packages/adapters/src/telephony.js";
import {
  FixtureClinic,
  MemorySink,
} from "../../../packages/adapters/src/clinic.js";
import { MemoryRepository } from "../../../packages/adapters/src/storage.js";
import type { Config } from "./config.js";
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createServer(
  c: Config,
  deps: {
    repository: Repository;
    clinic: ClinicDataSource;
    sink: ActionSink;
    engine: () => ConversationEngine;
  },
) {
  const app = Fastify({ logger: false, bodyLimit: 32000 });
  const calls = new Map<string, CallRuntime>();
  const seen = new Set((await deps.repository.events()).map((e) => e.callId));
  const delivery = new DeliveryService(deps.repository, deps.sink);
  const labDelivery = new DeliveryService(
    new MemoryRepository(),
    new MemorySink(),
  );
  const tickets = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const close = async (call: CallRuntime) => {
    clearTimeout(timers.get(call.callId));
    timers.delete(call.callId);
    try {
      await call.close();
    } finally {
      calls.delete(call.callId);
    }
  };
  const add = (
    id: string,
    output?: { write: PacedAudio["write"]; clear: () => void },
    lab = false,
    ended: () => void = () => {},
    publish: (
      event: import("../../../packages/contracts/src/index.js").DomainEvent,
    ) => void = () => {},
  ) => {
    if (calls.size >= 20) throw new Error("Capacity exceeded");
    if (seen.has(id)) throw new Error("Duplicate call");
    seen.add(id);
    const call = new CallRuntime(
      deps.engine(),
      lab ? new FixtureClinic() : deps.clinic,
      deps.repository,
      lab ? labDelivery : delivery,
      id,
      new Date(),
      publish,
      (f) => output?.write(f) ?? Promise.resolve(),
      () => output?.clear(),
    );
    calls.set(id, call);
    timers.set(
      id,
      setTimeout(() => {
        ended();
        void close(call).catch(() => {});
      }, 180000),
    );
    return call;
  };
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      if (
        c.CONSOLE_TOKEN &&
        !equal(req.headers.authorization ?? "", `Bearer ${c.CONSOLE_TOKEN}`)
      )
        return reply.code(401).send({ error: "unauthorised" });
      // Reject cross-origin browser writes even for the local keyless laboratory.
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return reply.code(403).send({ error: "origin_not_allowed" });
    }
  });
  app.setErrorHandler((error, _req, reply) =>
    reply.code(error instanceof z.ZodError ? 400 : 500).send({
      error:
        error instanceof z.ZodError ? "invalid_request" : "operation_failed",
    }),
  );
  app.get("/health", async () => ({ ok: true }));
  app.get("/api/config", async () => ({
    engine: c.ENGINE,
    clinic: c.CLINIC,
    store: c.STORE,
    simulation: c.CLINIC === "fixture",
  }));
  app.get("/api/events", async () => ({
    events: (await deps.repository.events()).slice(-1000),
    deliveries: await deps.repository.deliveries(),
    active: [...calls.keys()],
  }));
  app.post("/api/calls", async (_req, reply) => {
    if (c.CLINIC !== "fixture")
      return reply.code(403).send({ error: "lab_only" });
    const call = add(randomUUID());
    try {
      await call.start();
      await call.flush();
      return { callId: call.callId };
    } catch (error) {
      await close(call);
      throw error;
    }
  });
  app.post("/api/calls/:id/text", async (req, reply) => {
    const { id } = req.params as { id: string };
    const call = calls.get(id);
    if (!call) return reply.code(404).send({ error: "call_not_found" });
    const { text } = z
      .object({ text: z.string().min(1).max(8000) })
      .strict()
      .parse(req.body);
    await call.text(text);
    await call.flush();
    return { ok: true };
  });
  app.post("/api/calls/:id/close", async (req, reply) => {
    const call = calls.get((req.params as { id: string }).id);
    if (!call) return reply.code(404).send({ error: "call_not_found" });
    await close(call);
    return { ok: true };
  });
  await app.register(websocket, { options: { maxPayload: 32000 } });
  app.post("/api/voice-ticket", async (_req, reply) => {
    if (c.ENGINE === "text")
      return reply.code(409).send({ error: "voice_engine_required" });
    for (const [key, expiry] of tickets)
      if (expiry < Date.now()) tickets.delete(key);
    if (tickets.size >= 100)
      return reply.code(429).send({ error: "too_many_tickets" });
    const ticket = randomUUID();
    tickets.set(ticket, Date.now() + 30000);
    return { ticket };
  });
  app.get(
    "/ws/browser",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const ticket = (req.query as { ticket?: string }).ticket ?? "";
        const expiry = tickets.get(ticket);
        tickets.delete(ticket);
        if (!expiry || expiry < Date.now())
          return reply.code(401).send({ error: "invalid_ticket" });
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          return reply.code(403).send({ error: "origin_not_allowed" });
      },
    },
    (socket) => {
      const id = "browser-" + randomUUID();
      const audio = new PacedAudio(socket, id);
      let call: CallRuntime | undefined;
      let ready = false;
      let ended = false;
      let chain = Promise.resolve();
      let pending = 0;
      const send = (event: object) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(event));
      };
      const finish = () => {
        if (ended) return;
        ended = true;
        audio.clear();
        if (call) void close(call).catch(() => {});
      };
      socket.on("close", finish);
      socket.on("error", finish);
      socket.on("message", (raw, binary) => {
        if (!ready || ended || !binary) {
          socket.close(1008, "Audio not ready");
          return;
        }
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer);
        if (bytes.length !== 160 || ++pending > 100) {
          socket.close(1009, "Invalid audio frame or backlog");
          return;
        }
        chain = chain
          .then(async () => {
            if (!ended)
              await call!.audio({ data: bytes, format: TELEPHONE_AUDIO });
          })
          .catch(() => socket.close(1011, "Audio failed"))
          .finally(() => pending--);
      });
      try {
        call = add(
          id,
          {
            write: (f) => audio.write(f),
            clear: () => {
              audio.clear();
              send({ event: "clear" });
            },
          },
          true,
          () => socket.close(1000, "Time limit"),
          (event) => {
            if (event.type === "engine.error") send({ type: "error" });
          },
        );
        call.emit("call.lab", {
          transport: "browser",
          clinic: "fixture",
          submission: "simulation",
        });
        void call
          .start(true)
          .then(() => {
            if (!ended) {
              ready = true;
              send({ type: "ready", callId: id });
            }
          })
          .catch(() => {
            send({ type: "error" });
            socket.close(1011, "Engine unavailable");
            finish();
          });
      } catch {
        socket.close(1013, "Unavailable");
        finish();
      }
    },
  );
  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const token = (req.query as { token?: string }).token ?? "";
        if (c.ENGINE === "text")
          return reply.code(409).send({ error: "voice_engine_required" });
        if (c.TRANSPORT_TOKEN && !equal(token, c.TRANSPORT_TOKEN))
          return reply.code(401).send({ error: "unauthorised" });
      },
    },
    (socket) => {
      let call: CallRuntime | undefined;
      let chain = Promise.resolve();
      let pending = 0;
      let ended = false;
      const setupTimeout = setTimeout(
        () => socket.close(1008, "Start required"),
        12000,
      );
      const finish = () => {
        if (ended) return;
        ended = true;
        clearTimeout(setupTimeout);
        if (call) void close(call).catch(() => {});
      };
      socket.on("error", finish);
      socket.on("close", finish);
      socket.on("message", (raw) => {
        if (ended) return;
        if (++pending > 250) {
          socket.close(1009, "Input backlog");
          finish();
          return;
        }
        chain = chain
          .then(async () => {
            if (ended) return;
            const e = JSON.parse(raw.toString());
            if (e.event === "connected") return;
            if (e.event === "start") {
              if (call) throw new Error("Repeated start");
              const start = startSchema.parse(e);
              clearTimeout(setupTimeout);
              call = add(
                start.start.callSid,
                new PacedAudio(socket, start.streamSid),
              );
              await call.start(true);
              return;
            }
            if (e.event === "media") {
              if (!call) throw new Error("Start required");
              const payload = z
                .string()
                .min(1)
                .max(16000)
                .regex(/^[A-Za-z0-9+/]+={0,2}$/)
                .parse(e.media?.payload);
              await call.audio({
                data: Buffer.from(payload, "base64"),
                format: TELEPHONE_AUDIO,
              });
              return;
            }
            if (e.event === "stop") {
              socket.close(1000);
              finish();
              return;
            }
          })
          .catch(() => {
            socket.close(1011, "Call failed");
            finish();
          })
          .finally(() => {
            pending--;
          });
      });
    },
  );
  const consoleRoot = resolve("apps/console/dist");
  if (existsSync(consoleRoot))
    await app.register(fastifyStatic, { root: consoleRoot });
  const retry = setInterval(() => {
    void delivery.recover().catch(() => {});
  }, 2000);
  retry.unref();
  await delivery.recover();
  app.addHook("onClose", async () => {
    clearInterval(retry);
    await Promise.allSettled([...calls.values()].map(close));
    await deps.repository.close();
  });
  return app;
}
