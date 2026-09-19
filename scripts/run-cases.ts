import { runPublicCases } from "../lib/cases/replay";

const { source, results } = await runPublicCases();
const passed = results.filter((item) => item.passed).length;
console.log(`source=${source.kind} ${source.name}`);
console.log(`passed ${passed}/${results.length}`);
for (const item of results) {
  const mark = item.passed ? "ok" : "FAIL";
  const detail = item.checks.map((check) => `${check.name}:${check.ok ? "ok" : check.detail}`).join(" | ");
  console.log(`${mark}\t${item.problemId}\t${item.caseId}\t${detail}`);
}
process.exit(passed === results.length ? 0 : 1);
