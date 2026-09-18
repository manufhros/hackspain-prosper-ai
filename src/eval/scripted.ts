import { actionsEqual, type ScoredAction } from "./normalize";
import {
  SIMPLE_BOOKING_FIXTURES,
  type ScriptedFixture,
} from "./fixtures/simple-booking";
import { DOCTOR_AND_SITE_FIXTURES } from "./fixtures/doctor-and-site";
import { TurnEngine } from "../turn/engine";

type PublicCase = {
  id: string;
  reference_time: string;
  expected: { acceptable: Array<{ actions: ScoredAction[] }> };
};

async function runFixture(fixture: ScriptedFixture, caseData: PublicCase) {
  let extractionIndex = 0;
  const engine = new TurnEngine(`eval-${fixture.caseId}`, fixture.fromNumber, {
    drySubmit: true,
    referenceTime: caseData.reference_time,
    extractor: async () => fixture.turns[extractionIndex++]!.extraction,
  });

  for (const turn of fixture.turns) {
    await engine.process(turn.text);
  }

  const actual = engine.state.submissions.map(({ action, payload }) => {
    const { call_id: _, ...fields } = payload;
    return action === "REGISTER"
      ? { action, new_patient: fields }
      : ({ action, ...fields } as ScoredAction);
  });
  const passed = caseData.expected.acceptable.some(({ actions }) =>
    actionsEqual(actual, actions),
  );
  return { passed, actual, state: engine.state };
}

const data = (await Bun.file(
  new URL("../../task/public-cases.json", import.meta.url),
).json()) as { cases: PublicCase[] };

let passed = 0;
const fixtures = [...SIMPLE_BOOKING_FIXTURES, ...DOCTOR_AND_SITE_FIXTURES];
for (const fixture of fixtures) {
  const caseData = data.cases.find((item) => item.id === fixture.caseId);
  if (!caseData) throw new Error(`Missing public case ${fixture.caseId}`);
  const result = await runFixture(fixture, caseData);
  if (result.passed) passed += 1;
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${fixture.caseId} ${JSON.stringify(result.actual)}`,
  );
  if (!result.passed) {
    console.log(`  violations=${JSON.stringify(result.state.violations)}`);
    console.log(
      `  state=${JSON.stringify({
        phase: result.state.phase,
        constraints: result.state.constraints,
        patient: result.state.resolvedPatientId,
        slots: result.state.lastAvailability?.slots.length,
        offer: result.state.offer,
      })}`,
    );
    console.log(`  expected=${JSON.stringify(caseData.expected.acceptable)}`);
  }
}

console.log(`\n${passed}/${fixtures.length} scripted cases passed`);
if (passed !== fixtures.length) process.exitCode = 1;
