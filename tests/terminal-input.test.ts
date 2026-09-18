import { expect, spyOn, test } from "bun:test";
import { type Key } from "node:readline";
import { Terminal, type View } from "../src/terminal";

const view: View = { tab: 0, tabs: ["Cases"], items: [], selected: 0, detail: "", scroll: 0, status: "", footer: "", mode: "", filter: "" };
function input(terminal: Terminal, name: string, text = "", ctrl = false) {
  (terminal as unknown as { handleKey(text: string, key: Key): void }).handleKey(text, { name, ctrl });
}
test("prompt editing preserves Unicode, masks secrets, and cancels on abort", async () => {
  const output: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk: any) => { output.push(String(chunk)); return true; });
  try {
    const terminal = new Terminal(() => view, () => {});
    const answer = terminal.ask("Edit", "ac");
    input(terminal, "left"); input(terminal, "b", "b");
    input(terminal, "home"); input(terminal, "delete");
    input(terminal, "end"); input(terminal, "", "👩‍💻"); input(terminal, "backspace");
    input(terminal, "return"); expect(await answer).toBe("bc");
    const cancel = new AbortController();
    const secret = terminal.ask("Secret", "synthetic-secret", true, cancel.signal);
    expect(output.at(-1)).not.toContain("synthetic-secret");
    expect(output.at(-1)).toContain("****************");
    cancel.abort(); expect(await secret).toBeNull();
  } finally { write.mockRestore(); }
});
test("direct-key choices need no Enter and clean up timeout and abort readers", async () => {
  const write = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const terminal = new Terminal(() => view, () => {});
    const choice = terminal.choose("Space records", ["space", "t"]);
    input(terminal, "x", "x"); input(terminal, "space", " "); expect(await choice).toBe("space");
    expect(await terminal.choose("Limit", ["space"], undefined, 1)).toBe("timeout");
    const cancel = new AbortController();
    const pending = terminal.choose("Wait", ["space"], cancel.signal); cancel.abort(); expect(await pending).toBeNull();
    const next = terminal.ask("Next"); input(terminal, "return"); expect(await next).toBe("");
  } finally { write.mockRestore(); }
});
