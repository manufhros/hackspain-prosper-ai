import { CasesBoard } from "@/components/cases-board";
import { loadPublicCases } from "@/lib/cases/load";
import { PROBLEM_WEIGHTS } from "@/lib/cases/types";

export default function CasesPage() {
  const cases = loadPublicCases().map((item) => ({
    id: item.id,
    problem_id: item.problem_id,
    weight: PROBLEM_WEIGHTS[item.problem_id] ?? 0,
    language: item.language,
    summary: item.summary,
    expected: item.expected.acceptable[0]?.actions.map((action) => action.action) ?? [],
  }));
  return <CasesBoard cases={cases} />;
}
