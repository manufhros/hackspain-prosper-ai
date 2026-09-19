import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATUS,
  filterCalls,
  duration,
  dayKey,
  dayLabel,
  escapeHTML,
} from "../../public/model.js";
import { createDemo } from "../../public/demo.js";

test("history search tolerates Spanish accents and preserves newest-first order", () => {
  const calls = [
    { id: "a", name: "José", phone: "123", startedAt: "2026-09-19T08:00:00Z" },
    {
      id: "b",
      name: "José Martín",
      phone: "456",
      startedAt: "2026-09-19T09:00:00Z",
    },
  ];
  assert.deepEqual(
    filterCalls(calls, "JOSE").map((call) => call.id),
    ["b", "a"],
  );
  assert.deepEqual(
    filterCalls(calls, "456").map((call) => call.id),
    ["b"],
  );
  assert.equal(filterCalls(calls, "nadie").length, 0);
});

test("date groups use Madrid rather than UTC and call duration does not go negative", () => {
  assert.equal(dayKey("2026-09-18T23:00:00Z"), "2026-09-19");
  assert.equal(
    dayLabel("2026-09-18T23:00:00Z", new Date("2026-09-19T12:00:00Z")),
    "Hoy",
  );
  assert.equal(
    duration("2026-09-19T10:00:00Z", "2026-09-19T10:02:14Z"),
    "02:14",
  );
  assert.equal(
    duration("2026-09-19T10:00:00Z", "2026-09-19T09:00:00Z"),
    "00:00",
  );
});

test("untrusted caller and tool content is escaped before entering HTML", () => {
  assert.equal(
    escapeHTML('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(escapeHTML("a&b'"), "a&amp;b&#39;");
});

test("demo statuses match the approved vocabulary and fixture never claims a real booking", () => {
  const calls = createDemo(Date.parse("2026-09-19T08:26:00Z"));
  assert.equal(STATUS.active.label, "En curso");
  assert.equal(STATUS.completed.label, "Finalizada");
  assert.equal(STATUS.missed.label, "No atendida");
  assert.equal(calls[0].tools[2].status, "running");
  assert.ok(calls.every((call) => call.id.startsWith("demo-")));
  assert.ok(
    calls.every((call) =>
      call.tools.every((tool) => tool.name !== "submit_book"),
    ),
  );
});
