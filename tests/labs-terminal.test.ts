import { expect, test } from "bun:test";
import { cases } from "../src/data";
import { evaluate } from "../src/evaluate";
import { contractDiagnostics, rankSites, resolveRelativeDate } from "../src/labs";
import { fit, render, safeText, type View } from "../src/terminal";

test("relative dates use Madrid connection day and strictly future weekdays", () => {
  expect(resolveRelativeDate("this coming Thursday", "2026-09-24T10:00:00+02:00").requested_day).toBe("2026-10-01");
  expect(resolveRelativeDate("tomorrow", "2026-09-18T23:30:00Z").requested_day).toBe("2026-09-20");
  const holiday = resolveRelativeDate("first thing on Monday the twelfth of October", "2026-09-18T09:00:00+02:00");
  expect(holiday.requested_day).toBe("2026-10-12");
  expect(holiday.closure).toContain("all sites closed");
  expect(resolveRelativeDate("on Saturday morning", "2026-09-18T09:00:00+02:00").part_of_day).toBe("morning");
  expect(() => resolveRelativeDate("sometime", "2026-09-18T09:00:00+02:00")).toThrow();
});
test("nearest-site ranking only uses caller-supplied eligible sites", () => {
  const sites = [{ id: "far", latitude: 41, longitude: -3 }, { id: "near", latitude: 40.01, longitude: -3 }];
  expect(rankSites(40, -3, sites)[0]!.id).toBe("near");
  expect(() => rankSites(400, -3, sites)).toThrow();
  expect(contractDiagnostics().okay).toBe(true);
});
test("stale anchors cannot excuse a malformed record or a privacy leak", () => {
  const item = cases.find(c => c.protected.length)!;
  expect(evaluate(item, { actions: [] }, undefined, "2026-09-19T09:00:00Z").status).toBe("fail");
  expect(evaluate(item, item.expected.acceptable[0], [{ role: "agent", text: item.protected[0]!.value }], "2026-09-19T09:00:00Z").status).toBe("fail");
});
const view: View = { tab: 0, tabs: ["Cases", "API", "Labs", "Results", "Docs", "Setup"], items: ["One", "Two", "Three"], selected: 1,
  detail: "Clínica Arenal\n" + "This is a long line for scrolling. ".repeat(80), scroll: 0, status: "Offline", footer: "Enter run", mode: "OFFLINE", filter: "" };
for (const [width, height] of [[120, 36], [90, 24], [80, 24], [40, 12]]) test(`terminal frame fits ${width}x${height}`, () => {
  const output = render(view, width!, height!, false).split("\r\n");
  expect(output).toHaveLength(height!);
  expect(output.every(line => Bun.stringWidth(line) <= width!)).toBe(true);
  expect(output.join()).toContain("EL TURNO");
});
test("terminal renders empty/error states, scrolls, and strips remote control sequences", () => {
  expect(render({ ...view, items: [], detail: "No matches" }, 100, 24, false)).toContain("No matches");
  expect(render({ ...view, scroll: 100 }, 100, 24, false)).not.toBe(render(view, 100, 24, false));
  expect(safeText("\x1b[2Jhello\x1b]52;c;ZXhwbG9pdA==\x07")).toBe("hello");
  expect(Bun.stringWidth(fit("España 🎉", 10))).toBe(10);
  expect(render(view, 20, 5, false)).toContain("Resize terminal");
});
