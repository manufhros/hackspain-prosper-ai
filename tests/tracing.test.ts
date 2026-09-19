import { describe, it, expect, vi } from "vitest";
import { Laminar } from "@lmnr-ai/lmnr";
import { TracedEngine } from "../packages/adapters/src/tracing.js";
import type { ConversationEngine, EngineHost } from "../packages/contracts/src/index.js";

describe("call tracing", () => {
  it("keeps per-call contexts and never puts patient arguments or results in spans", async () => {
    const spans: any[] = [];
    const active: any[] = [];
    const outputs: unknown[] = [];
    vi.spyOn(Laminar, "startSpan").mockImplementation((options) => {
      const span = { options, parent: active.at(-1), end: vi.fn(), setStatus: vi.fn(), setAttribute: vi.fn(), addEvent: vi.fn() };
      spans.push(span); return span as any;
    });
    vi.spyOn(Laminar, "withSpan").mockImplementation((span, fn) => {
      active.push(span); try { return fn(); } finally { active.pop(); }
    });
    vi.spyOn(Laminar, "setSpanOutput").mockImplementation(value => { outputs.push(value); });
    const hosts: EngineHost[] = [];
    const engine = () => ({ id: "fake", capabilities: {},
      start: async (host: EngineHost) => { hosts.push(host); },
      acceptText: async () => {}, acceptAudio: async () => {}, interrupt: async () => {}, close: async () => {},
    }) as unknown as ConversationEngine;
    const host = (callId: string) => ({ context: () => JSON.stringify({ callId, patient: "SECRET" }),
      tool: async () => ({ ok: true, data: { patient: "SECRET" } }), event: vi.fn(),
    }) as unknown as EngineHost;
    try {
      const a = new TracedEngine(engine()), b = new TracedEngine(engine());
      await Promise.all([a.start(host("a"), []), b.start(host("b"), [])]);
      await hosts[0]!.tool("unknown", { dni: "SECRET" });
      await Promise.all([a.close(), b.close()]);
      expect(spans[0].options.sessionId).toBe("a");
      expect(spans[1].options.sessionId).toBe("b");
      expect(spans[2].parent).toBe(spans[0]);
      expect(JSON.stringify(spans.map(s => s.options))).not.toContain("SECRET");
      expect(outputs).toEqual([{ ok: true }]);
      expect(spans.every(s => s.end.mock.calls.length === 1)).toBe(true);
    } finally { vi.restoreAllMocks(); }
  });
});
