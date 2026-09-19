import { CallLab } from "@/components/call-lab";
import { loadPublicCases } from "@/lib/cases/load";

export default function TestsPage() {
  const cases = loadPublicCases().map((item) => ({
    id: item.id,
    problem_id: item.problem_id,
    language: item.language,
    summary: item.summary,
    name: item.persona.name,
    voice: item.persona.voice,
    phone: item.persona.phone ?? item.persona.data.phone,
    expected: item.expected.acceptable[0]?.actions.map((action) => action.action) ?? [],
  }));
  return <CallLab cases={cases} />;
}
