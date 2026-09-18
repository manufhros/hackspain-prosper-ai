import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import rawCases from "../task/public-cases.json";
import rawSchema from "../task/openapi.json";

export type ObjectValue = Record<string, unknown>;
export type Action = ObjectValue & { action: string };
export type Outcome = { actions: Action[] };
export type TranscriptTurn = { role: "agent" | "caller"; text: string };
export interface PublicCase {
  id: string;
  problem_id: string;
  reference_time: string;
  language: string;
  summary: string;
  persona: { name: string; description: string; data: ObjectValue; objectives: string[] };
  caller_prompt: string;
  audio: { background: string; signal_to_noise_db: number | null };
  protected: { kind: string; value: string }[];
  expected: { acceptable: Outcome[] };
}
export interface Schema {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  items?: Schema;
  enum?: string[];
  const?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  description?: string;
  default?: unknown;
  examples?: unknown[];
}
export interface Parameter { name: string; in: string; required?: boolean; description?: string; schema: Schema }
export interface Operation {
  summary: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content: { "application/json": { schema: Schema } } };
}
export const root = fileURLToPath(new URL("../", import.meta.url));
export const cases = rawCases.cases as PublicCase[];
export const schema = rawSchema as unknown as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};
export const documents = Object.fromEntries(
  readdirSync(join(root, "task")).filter(name => name.endsWith(".md"))
    .map(name => [name, readFileSync(join(root, "task", name), "utf8")]),
);
export const problems = [...documents["problems.md"]!.matchAll(
  /^\| (\d+) \| \[([^\]]+)\]\([^)]*\) \| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
)].map(([, number, name, id, , weight, open]) => ({
  number: Number(number), name: name!, id: id!, weight: Number(weight?.trim()) || 0,
  openAtSnapshot: open?.trim() === "yes",
  cases: cases.filter(item => item.problem_id === id),
}));
export const operations = Object.entries(schema.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({ path, method: method.toUpperCase(), ...operation })),
);
export type Endpoint = (typeof operations)[number];
export const actionRoutes: Record<string, string> = {
  REGISTER: "register", BOOK: "book", RESCHEDULE: "reschedule", CANCEL: "cancel",
  NO_ACTION: "no-action", ESCALATE: "escalate",
};
export function resolveSchema(input: Schema): Schema {
  if (!input.$ref) return input;
  const ref = schema.components.schemas[input.$ref.split("/").at(-1)!];
  if (!ref) throw new Error(`Unknown schema: ${input.$ref}`);
  return { ...ref, ...input, $ref: undefined };
}
export function caseById(id: string): PublicCase {
  const item = cases.find(c => c.id === id);
  if (!item) throw new Error(`Unknown public case: ${id}`);
  return item;
}
export function problemStatement(number: number): string {
  return documents["problems.md"]!.split(new RegExp(`^## ${number}\\. `, "m"))[1]?.split(/^## \d+\. /m)[0]?.trim() ?? "";
}
