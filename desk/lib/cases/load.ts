import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PublicCase, PublicCaseFile, SimCase } from "./types";

function catalogPath() {
  const candidates = [
    path.join(process.cwd(), "lib/cases/public-cases.json"),
    path.join(process.cwd(), "task/public-cases.json"),
    path.join(process.cwd(), "../task/public-cases.json"),
  ];
  return candidates.find((file) => existsSync(file));
}

function loadCatalog(): PublicCaseFile {
  const file = catalogPath();
  if (!file) {
    throw new Error("No se encontró public-cases.json (desk/lib/cases o task/).");
  }
  return JSON.parse(readFileSync(file, "utf8")) as PublicCaseFile;
}

const catalog = loadCatalog();

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
