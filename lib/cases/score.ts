export type ScoredAction = Record<string, unknown> & { action: string };

function fold(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

export function normalizeNationalId(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "").replace(/^(?:0034|34)/, "");
}

export function normalizeEmail(value: string) {
  return value.replace(/\s/g, "").toLowerCase();
}

export function normalizeSlot(value: string, shiftDays = 0) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + shiftDays);
  return Math.floor(date.getTime() / 60_000);
}

export function normalizeEnum(value: string) {
  return fold(value);
}

export function normalizeAction(action: ScoredAction, slotShiftDays = 0) {
  const source =
    action.action === "REGISTER" && action.new_patient && typeof action.new_patient === "object"
      ? { action: action.action, ...(action.new_patient as Record<string, unknown>) }
      : action;
  const normalized: Record<string, unknown> = {};
  const surnames: string[] = [];

  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined) continue;
    if (key === "slot" && typeof raw === "string") {
      normalized[key] = normalizeSlot(raw, slotShiftDays);
    } else if (key === "national_id" && typeof raw === "string") {
      normalized[key] = normalizeNationalId(raw);
    } else if (key === "phone" && typeof raw === "string") {
      normalized[key] = normalizePhone(raw);
    } else if (key === "email" && typeof raw === "string") {
      normalized[key] = normalizeEmail(raw);
    } else if (key === "given_name" && typeof raw === "string") {
      normalized[key] = fold(raw);
    } else if ((key === "first_surname" || key === "second_surname") && typeof raw === "string") {
      surnames.push(fold(raw));
    } else if ((key === "reason" || key === "appointment_type_id") && typeof raw === "string") {
      normalized[key] = normalizeEnum(raw);
    } else {
      normalized[key] = raw;
    }
  }
  if (surnames.length) normalized.surnames = surnames.sort();
  return normalized;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function actionsEqual(
  actual: ScoredAction[],
  expected: ScoredAction[],
  expectedSlotShiftDays = 0,
) {
  return (
    stableJson(actual.map((action) => normalizeAction(action))) ===
    stableJson(expected.map((action) => normalizeAction(action, expectedSlotShiftDays)))
  );
}

export function matchesAcceptable(
  actual: ScoredAction[],
  acceptable: Array<{ actions: ScoredAction[] }>,
  expectedSlotShiftDays = 0,
) {
  return acceptable.some((option) =>
    actionsEqual(actual, option.actions, expectedSlotShiftDays),
  );
}
