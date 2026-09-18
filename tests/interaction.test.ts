import { expect, test } from "bun:test";
import { type Key } from "node:readline";
import { Workbench } from "../src/workbench";
import { type View } from "../src/terminal";

test("keyboard navigation, search, action cancellation and import errors without starting a terminal", async () => {
  let current!: () => View;
  let press!: (key: Key, text: string) => void;
  let closed = false;
  const answers: (string | null)[] = [];
  const questions: string[] = [];
  new Workbench((view, onKey) => {
    current = view; press = onKey;
    return { abort: new AbortController(), start() {}, draw() {}, close() { closed = true; },
      async ask(title) { questions.push(title); return answers.shift() ?? null; } };
  });
  const type = (text: string, key: Key = {}) => press(key, text);
  const idle = async () => { for (let i = 0; i < 100 && current().footer.startsWith("Working"); i++) await Bun.sleep(1); expect(current().footer).not.toStartWith("Working"); };
  expect(current().items).toHaveLength(74); // 73 cases + Switchboard diagnostic
  expect(current().detail).not.toContain("ARCHIVED ACCEPTABLE OUTCOMES");
  type("a"); expect(current().detail).toContain("ARCHIVED ACCEPTABLE OUTCOMES");
  type("2"); expect(current().items).toHaveLength(17);
  type("7"); expect(current().items).toContain("Run speech + model smoke tests");
  expect(current().items).toContain("Free conversation · microphone or text");
  type("", { name: "down" });
  answers.push(null); type("", { name: "return" }); await idle();
  expect(questions.at(-1)).toBe("Language: en / es / ca");
  expect(current().detail).toContain("does not change case scores");
  type("1"); answers.push(null); type("f"); await idle();
  expect(questions.at(-1)).toBe("Language: en / es / ca");
  answers.push("invalid"); type("f"); await idle();
  expect(current().detail).toContain("Choose en, es or ca");
  type("7");
  type("", { name: "tab" }); expect(current().tab).toBe(0);
  type("", { name: "tab", shift: true }); expect(current().tab).toBe(6);
  type("3"); expect(current().items).toContain("Submission contract");
  type("", { name: "return" }); await idle();
  expect(current().detail).toContain("WORKBENCH SELF-CHECK");
  type("1");
  answers.push("third_party"); type("/"); await idle();
  expect(current().items).toHaveLength(4);
  type("", { name: "escape" }); expect(current().items).toHaveLength(74);
  answers.push("2", null); type("e"); await idle();
  expect(questions).toContain("patient_id");
  expect(current().detail).toContain("patient_id");
  answers.push(`/nonexistent-${crypto.randomUUID()}.json`); type("i"); await idle();
  expect(current().status).toContain("Could not complete action");
  type("q"); expect(closed).toBe(true);
});
