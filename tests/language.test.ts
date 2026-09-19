import { allowAction } from "./fixtures/action-decision";
import { expect, test } from "bun:test";
import { ConversationLanguage } from "../src/voice/language";
import { Receptionist } from "../src/voice/agent";
import { type Inference, type Message } from "../src/voice/runtime";

test("clear caller language overrides greeting and ASR mistakes; explicit preference persists", () => {
  const language = new ConversationLanguage("es");
  language.recognize("es");
  expect(language.update("Hello")).toBe("en");
  expect(language.update("I need an appointment at Arenal Centro with Carmen Ortiz")).toBe("en");
  expect(language.update("Responde en español, please")).toBe("es");
  language.recognize("en");
  expect(language.update("Yes")).toBe("es");
  expect(language.update("Parla en català")).toBe("ca");
  expect(language.update("sí")).toBe("ca");
  expect(language.update("Please speak English")).toBe("en");
});

test("a wrong-language draft is never spoken and active language uses a single system message", async () => {
  const replies = ["Buenos días, ¿qué cita necesita?", "How can I help you?"];
  const seen: Message[][] = [];
  const inference: Inference = { decideAction: allowAction, async audio() { throw new Error("Unexpected audio"); }, async removeAudio() {}, async chat(messages: Message[]) {
    seen.push(structuredClone(messages));
    return { message: { role: "assistant", content: replies.shift()! }, elapsed_ms: 1 };
  } };
  const agent = new Receptionist(inference, { request: async () => { throw new Error("Unexpected clinic read"); } }, "2026-09-18T09:00:00+02:00", "es");
  agent.setLanguage("en");
  expect(await agent.turn("Hello", new AbortController().signal)).toBe("How can I help you?");
  expect(agent.currentLanguage).toBe("en");
  expect(agent.transcript.map(t => t.text)).toEqual(["Hello", "How can I help you?"]);
  for (const messages of seen) {
    expect(messages.filter(m => m.role === "system")).toHaveLength(1);
    expect(messages[0]!.content).toContain("ACTIVE RESPONSE LANGUAGE: en");
  }
});
