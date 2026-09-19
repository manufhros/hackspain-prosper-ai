import assert from "node:assert/strict";
import { test } from "node:test";
import { renderOverview } from "../../public/overview.js";

const empty = {
  period: "today",
  from: "2026-09-19",
  to: "2026-09-19",
  persistent: true,
  totals: {
    calls: 0,
    answered: 0,
    forwarded: 0,
    bookings: 0,
    durationSamples: 0,
  },
  daily: [{ day: "2026-09-19", calls: 0, bookings: 0, forwarded: 0 }],
};
test("empty overview shows zeros, no invented percentages and an accessible exact-value table", () => {
  const html = renderOverview(empty);
  assert.match(html, /Aún no hay llamadas/);
  assert.match(html, /Tasa de atención<\/dt><dd>—/);
  assert.match(html, /<caption/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.match(html, /Métricas conservadas entre reinicios/);
});
test("overview presents counts and actual duration, retains expanded breakdown and escapes metadata", () => {
  const html = renderOverview(
    {
      ...empty,
      from: '<img src=x onerror="alert(1)">',
      totals: {
        ...empty.totals,
        calls: 4,
        answered: 3,
        bookings: 2,
        durationSamples: 2,
        averageDurationMs: 125000,
      },
    },
    true,
  );
  assert.match(html, /75 %/);
  assert.match(html, /02:05/);
  assert.match(html, /overview-breakdown" open/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});
test("active calls alone do not produce a made-up duration average", () => {
  const html = renderOverview({
    ...empty,
    totals: {
      ...empty.totals,
      calls: 3,
      answered: 1,
      active: 1,
      missed: 2,
      averageDurationMs: 0,
    },
  });
  assert.doesNotMatch(html, /00:00/);
});
