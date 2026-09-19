import publicCases from "./public-cases.json";
import type { PublicCase, PublicCaseFile, SimCase } from "./types";

// Bundle the catalog so Cloudflare does not need the repository filesystem.
const catalog = publicCases as PublicCaseFile;

export function loadPublicCases(): PublicCase[] {
  return catalog.cases;
}

export function getPublicCase(id: string): PublicCase | undefined {
  return catalog.cases.find((item) => item.id === id);
}

export function toSimCase(item: PublicCase): SimCase {
  const actions = item.expected.acceptable[0]?.actions.map((action) => action.action) ?? [];
  return {
    id: item.id,
    problem_id: item.problem_id,
    language: item.language,
    title: `${item.problem_id} · ${item.persona.name}`,
    prompt: item.summary,
    expected: actions.join(" + ") || "—",
    patient: item.persona.name,
    phone: item.persona.phone ?? item.persona.data.phone ?? "Número oculto",
  };
}

export function listPublicCases(): SimCase[] {
  return loadPublicCases().map(toSimCase);
}
