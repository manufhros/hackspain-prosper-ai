import { actionRoutes, operations, resolveSchema, type Action, type ObjectValue, type Schema } from "./data";

export const isObject = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
export const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
export const nationalId = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();
export function validNationalId(value: string): boolean {
  const id = nationalId(value);
  if (!/^(?:\d{8}|[XYZ]\d{7})[A-Z]$/.test(id)) return false;
  const digits = id.slice(0, -1).replace(/^[XYZ]/, letter => String("XYZ".indexOf(letter)));
  return "TRWAGMYFPDXBNJZSQVHLCKE"[Number(digits) % 23] === id.at(-1);
}
export function phone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 13 && digits.startsWith("0034") ? digits.slice(4)
    : digits.length === 11 && digits.startsWith("34") ? digits.slice(2) : digits;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
export function validSlot(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
export const madridDay = (value: string | Date): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

// Implements only the keywords present in the archived API's input schemas.
// Unknown properties are deliberately rejected to catch snake_case/route mistakes.
export function validate(value: unknown, input: Schema, path = "body"): string[] {
  const s = resolveSchema(input);
  const choices = s.anyOf ?? s.oneOf;
  if (choices) return choices.some(choice => validate(value, choice, path).length === 0)
    ? [] : [`${path}: does not match any allowed shape`];
  const errors: string[] = [];
  if (s.type === "null") return value === null ? [] : [`${path}: expected null`];
  if (s.type === "object") {
    if (!isObject(value)) return [`${path}: expected object`];
    for (const key of s.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, entry] of Object.entries(value)) {
      if (!s.properties?.[key]) errors.push(`${path}.${key}: unknown field`);
      else errors.push(...validate(entry, s.properties[key], `${path}.${key}`));
    }
  } else if (s.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (value.length < (s.minItems ?? 0)) errors.push(`${path}: at least ${s.minItems} item(s)`);
    if (s.items) value.forEach((v, i) => errors.push(...validate(v, s.items!, `${path}[${i}]`)));
  } else if (s.type === "integer" || s.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (s.type === "integer" && !Number.isInteger(value))) return [`${path}: expected ${s.type}`];
    if (s.minimum !== undefined && value < s.minimum) errors.push(`${path}: minimum ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) errors.push(`${path}: maximum ${s.maximum}`);
  } else if (s.type === "string") {
    if (typeof value !== "string") return [`${path}: expected string`];
    if (!value.trim() || value.length < (s.minLength ?? 0)) errors.push(`${path}: cannot be blank`);
    if (s.enum && !s.enum.includes(value)) errors.push(`${path}: choose ${s.enum.join(", ")}`);
    if (s.const !== undefined && value !== s.const) errors.push(`${path}: expected ${s.const}`);
    if (s.format === "date" && !validDate(value)) errors.push(`${path}: invalid ISO date`);
    if (s.format === "date-time" && !validSlot(value)) errors.push(`${path}: valid ISO timestamp with explicit timezone required`);
    if (path.endsWith(".national_id") && !validNationalId(value)) errors.push(`${path}: invalid DNI/NIE check letter or format`);
  } else if (s.type === "boolean" && typeof value !== "boolean") errors.push(`${path}: expected boolean`);
  return errors;
}
export function requestForAction(action: Action, callId: string): { path: string; body: ObjectValue } {
  const route = actionRoutes[action.action];
  if (!route) throw new Error(`Unknown action: ${action.action}`);
  const { action: _, ...fields } = action;
  const body = action.action === "REGISTER" ? { ...(isObject(fields.new_patient) ? fields.new_patient : {}), call_id: callId }
    : { ...fields, call_id: callId };
  return { path: `/api/v1/submit/${route}`, body };
}
export function validateAction(action: unknown): string[] {
  if (!isObject(action) || typeof action.action !== "string" || !actionRoutes[action.action]) return ["action: unknown or missing verb"];
  if (action.action === "REGISTER" && Object.keys(action).some(k => !["action", "new_patient"].includes(k))) return ["REGISTER: demographics must be nested under new_patient"];
  const { path, body } = requestForAction(action as Action, "local-validation");
  return validate(body, operations.find(o => o.path === path)!.requestBody!.content["application/json"].schema);
}
export function validateOutcome(value: unknown): string[] {
  if (!isObject(value) || !Array.isArray(value.actions)) return ["record: expected { actions: [...] }"];
  if (Object.keys(value).some(k => k !== "actions")) return ["record: unknown fields (expected only actions)"];
  if (!value.actions.length) return ["record.actions: silence always fails; submit an explicit action"];
  return value.actions.flatMap((a, i) => validateAction(a).map(error => `actions[${i}].${error}`));
}
