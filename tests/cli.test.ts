import { expect, test } from "bun:test";
import { root } from "../src/data";

test("headless CLI lists and templates the full roster, refuses unknown commands", async () => {
  for (const command of ["cases", "template", "--help", "unknown"]) {
    const child = Bun.spawn([process.execPath, "src/cli.ts", command], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [text, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(command === "unknown" ? 2 : 0);
    if (command === "cases") expect(text.trim().split("\n")).toHaveLength(73);
    if (command === "template") expect(JSON.parse(text)).toHaveLength(73);
    if (command === "--help") expect(text).toContain("No provider");
    if (command === "unknown") expect(error).toContain("Unknown command");
  }
});
