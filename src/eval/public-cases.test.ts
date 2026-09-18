import { describe, expect, test } from "bun:test";
import { DOCTOR_AND_SITE_FIXTURES } from "./fixtures/doctor-and-site";
import { SIMPLE_BOOKING_FIXTURES } from "./fixtures/simple-booking";
import {
  createFixtureCoverageReport,
  createPublicCaseCatalog,
  loadPublicCases,
} from "./public-cases";

const EXPECTED_COUNTS = {
  simple_booking: 4,
  doctor_and_site: 5,
  the_questions: 5,
  the_new_patient: 4,
  when_exactly: 5,
  the_rules: 5,
  no_slot_free: 4,
  change_and_cancel: 4,
  third_party: 4,
  nearest_site: 4,
  second_policy: 4,
  triage: 5,
  languages: 4,
  noise: 4,
  difficult_caller: 5,
  adversarial: 4,
  the_real_call: 3,
} as const;

describe("public case loader", () => {
  test("loads all 73 cases and exposes scoring fields", async () => {
    const catalog = await loadPublicCases();

    expect(catalog.cases).toHaveLength(73);
    for (const item of catalog.cases) {
      expect(item.reference_time).toBeTruthy();
      expect(Array.isArray(item.protected)).toBe(true);
      expect(item.expected.acceptable.length).toBeGreaterThan(0);
      for (const acceptable of item.expected.acceptable) {
        expect(Array.isArray(acceptable.actions)).toBe(true);
        for (const action of acceptable.actions) {
          expect(typeof action.action).toBe("string");
        }
      }
    }
  });

  test("groups the cases into the 17 scored problems without switchboard", async () => {
    const { byProblemId } = await loadPublicCases();

    expect(byProblemId.size).toBe(17);
    expect(byProblemId.has("switchboard")).toBe(false);
    expect(
      Object.fromEntries(
        Array.from(byProblemId, ([problemId, cases]) => [
          problemId,
          cases.length,
        ]),
      ),
    ).toEqual(EXPECTED_COUNTS);
  });

  test("rejects duplicate IDs in the public-case catalog", async () => {
    const { cases } = await loadPublicCases();

    expect(() => createPublicCaseCatalog([cases[0]!, cases[0]!])).toThrow(
      `Duplicate public case ID: ${cases[0]!.id}`,
    );
  });
});

describe("fixture coverage", () => {
  test("recognizes all 9 current fixtures", async () => {
    const catalog = await loadPublicCases();
    const fixtureIds = [
      ...SIMPLE_BOOKING_FIXTURES,
      ...DOCTOR_AND_SITE_FIXTURES,
    ].map(({ caseId }) => caseId);
    const report = createFixtureCoverageReport(catalog, fixtureIds);

    expect(fixtureIds).toHaveLength(9);
    expect(report.recognizedFixtureIds).toEqual(fixtureIds);
    expect(report.duplicateFixtureIds).toEqual([]);
    expect(report.unknownFixtureIds).toEqual([]);
    expect(report.missingCaseIds).toHaveLength(64);
    expect(report.complete).toBe(false);
  });

  test("reports duplicate, unknown, and missing fixture IDs", async () => {
    const catalog = await loadPublicCases();
    const knownId = catalog.cases[0]!.id;
    const report = createFixtureCoverageReport(catalog, [
      knownId,
      knownId,
      "unknown-case",
      "unknown-case",
    ]);

    expect(report.recognizedFixtureIds).toEqual([knownId]);
    expect(report.duplicateFixtureIds).toEqual([knownId, "unknown-case"]);
    expect(report.unknownFixtureIds).toEqual(["unknown-case"]);
    expect(report.missingCaseIds).toHaveLength(72);
    expect(report.missingCaseIds).not.toContain(knownId);
    expect(report.complete).toBe(false);
  });
});
