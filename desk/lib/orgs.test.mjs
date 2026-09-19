import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { isKnownOrganisation, ORGANISATIONS, organisationOf } from "./orgs.ts";
import { listStoredOrgSlugs, readStoredCalls } from "./call-query.ts";
import { faqCovers, suggestFaqFromCalls } from "./faq-suggestion.ts";
import { hospitalProfile } from "./hospital-profile.ts";
import { todayRange } from "./reporting.ts";

test("known organisations stay isolated by slug", () => {
  assert.equal(isKnownOrganisation("arenal"), true);
  assert.equal(isKnownOrganisation("other"), false);
  assert.equal(organisationOf("quironsalud")?.name, "Clínica Quirón");
  assert.ok(ORGANISATIONS.every((item) => item.slug && item.name));
});

test("admin aggregation lists slugs without leaking another clinic's calls", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("../migrations/0002_voice_calls.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0003_agent_audit.sql", import.meta.url), "utf8"));
  const insert = sqlite.prepare("INSERT INTO voice_calls (call_id, org_slug, started_at, summary) VALUES (?, ?, ?, ?)");
  insert.run("a1", "arenal", "2026-09-19T10:00:00.000Z", JSON.stringify({ outcome: "cita", site: "centro" }));
  insert.run("q1", "quironsalud", "2026-09-19T11:00:00.000Z", JSON.stringify({ outcome: "escalado" }));
  insert.run("foreign", "other", "2026-09-19T10:30:00.000Z", "{}");
  const db = { prepare(sql) { return { bind: (...args) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...args) }) }) }; } };
  const range = todayRange(new Date("2026-09-19T12:00:00Z"));
  const slugs = await listStoredOrgSlugs(db);
  const arenal = await readStoredCalls(db, "arenal", range);
  const quiron = await readStoredCalls(db, "quironsalud", range);
  assert.deepEqual(slugs, ["arenal", "other", "quironsalud"]);
  assert.deepEqual(arenal.map((call) => call.id), ["a1"]);
  assert.deepEqual(quiron.map((call) => call.id), ["q1"]);
  assert.equal(isKnownOrganisation("other"), false);
});

test("hospital prompt is prefilled with the selected clinic", () => {
  const arenal = hospitalProfile("arenal");
  assert.match(arenal.metaPrompt, /Clínica Arenal/);
  assert.match(arenal.extraInstructions, /Arenal Centro/);
  assert.match(arenal.extraInstructions, /sábados/);
  const sanitas = hospitalProfile("sanitas");
  assert.match(sanitas.metaPrompt, /Clínica Sanitas/);
  assert.doesNotMatch(sanitas.extraInstructions, /Arenal Centro/);
});

test("FAQ suggestion needs a frequent uncovered motive and never invents copy", () => {
  const faq = [{ question: "¿Qué centro abre los sábados?" }];
  const covered = [
    { motive: "¿Qué centro abre los sábados?", intent: "general_faq" },
    { motive: "¿Qué centro abre los sábados?", intent: "general_faq" },
  ];
  assert.equal(faqCovers("¿Qué centro abre los sábados?", faq), true);
  assert.equal(suggestFaqFromCalls(covered, faq), null);

  const uncovered = [
    { motive: "¿Hacéis analítica de sangre por la tarde?", intent: "general_faq" },
    { motive: "¿Hacéis analítica de sangre por la tarde?", intent: "general_faq" },
    { motive: "Me duele la rodilla", intent: "appointment_action" },
  ];
  const suggestion = suggestFaqFromCalls(uncovered, faq);
  assert.equal(suggestion?.question, "¿Hacéis analítica de sangre por la tarde?");
  assert.equal(suggestion?.count, 2);
  assert.match(suggestion?.evidence ?? "", /2 llamadas/);
  assert.equal(suggestFaqFromCalls(uncovered.slice(0, 1), faq), null);

  const clustered = [
    { motive: "Oh, yes. Could I change it later if I needed to?", intent: null },
    { motive: "Does that mean it can be changed if I need to?", intent: null },
  ];
  const later = suggestFaqFromCalls(clustered, faq);
  assert.equal(later?.count, 2);
  assert.match(later?.question ?? "", /change|changed/i);
});
