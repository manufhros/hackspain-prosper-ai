import type { PublicCase, PublicCaseFile } from "./types";
import file from "@/task/public-cases.json";

const catalog = file as PublicCaseFile;

export function loadPublicCases(): PublicCase[] {
  return catalog.cases;
}

export function getPublicCase(id: string): PublicCase | undefined {
  return catalog.cases.find((item) => item.id === id);
}

export function groupPublicCases(): Map<string, PublicCase[]> {
  const groups = new Map<string, PublicCase[]>();
  for (const item of catalog.cases) {
    const list = groups.get(item.problem_id) ?? [];
    list.push(item);
    groups.set(item.problem_id, list);
  }
  return groups;
}
