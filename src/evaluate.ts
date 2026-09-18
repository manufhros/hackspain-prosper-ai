import { cases, problems, type Action, type Outcome, type PublicCase, type TranscriptTurn } from "./data";
import { fold, isObject, madridDay, nationalId, phone, validateOutcome, validSlot } from "./validation";

export interface Evaluation {
  case_id: string;
  status: "pass" | "fail" | "needs_review";
  recordMatches: boolean;
  differences: string[];
  privacy: "not_applicable" | "missing_transcript" | "leak_detected" | "no_leak_detected";
  warnings: string[];
}
function normalizedAction(action: Action): Action {
  const value = structuredClone(action);
  if (typeof value.slot === "string" && Number.isFinite(Date.parse(value.slot))) {
    value.slot = new Date(Math.floor(Date.parse(value.slot) / 60000) * 60000).toISOString();
  }
  if (typeof value.reason === "string") value.reason = fold(value.reason);
  if (typeof value.policy_id === "string") value.policy_id = fold(value.policy_id);
  if (value.action === "REGISTER" && isObject(value.new_patient)) {
    const patient = value.new_patient;
    for (const field of ["given_name", "first_surname", "second_surname", "insurer"]) {
      if (typeof patient[field] === "string") patient[field] = fold(patient[field] as string);
    }
    if (typeof patient.first_surname === "string" && typeof patient.second_surname === "string") {
      [patient.first_surname, patient.second_surname] = [patient.first_surname, patient.second_surname].sort();
    }
    if (typeof patient.national_id === "string") patient.national_id = nationalId(patient.national_id);
    if (typeof patient.phone === "string") patient.phone = phone(patient.phone);
    if (typeof patient.email === "string") patient.email = patient.email.replace(/\s/g, "").toLowerCase();
  }
  return value;
}
function diff(expected: unknown, actual: unknown, path: string): string[] {
  if (isObject(expected) && isObject(actual)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
      .flatMap(key => diff(expected[key], actual[key], `${path}.${key}`));
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? []
    : [`${path}: expected ${JSON.stringify(expected) ?? "<absent>"}; received ${JSON.stringify(actual) ?? "<missing>"}`];
}
// Calls with two intents are compared as a multiset: order is a local assumption,
// never permission to discard a duplicate/extra action. The published docs do not
// explicitly specify action-order tolerance.
function compareActions(expected: Action[], actual: Action[]): string[] {
  if (expected.length !== actual.length) return [`actions: expected ${expected.length}; received ${actual.length}`];
  const permutations = (items: Action[]): Action[][] => items.length <= 1 ? [items]
    : items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest]));
  // Current public cases have at most two actions. Bound untrusted input.
  if (actual.length > 6) return ["actions: local comparison supports at most six actions"];
  return permutations(actual).map(order => expected.flatMap((action, i) => diff(action, order[i], `actions[${i}]`)))
    .sort((a, b) => a.length - b.length)[0] ?? [];
}
const digits: Record<string, string> = {};
for (const words of ["zero one two three four five six seven eight nine", "cero uno dos tres cuatro cinco seis siete ocho nueve", "zero un dos tres quatre cinc sis set vuit nou"]) {
  words.split(" ").forEach((word, index) => { digits[word] = String(index); });
}
export function privacyLeaks(item: PublicCase, transcript: TranscriptTurn[]): string[] {
  const leaks = new Set<string>();
  for (const turn of transcript.filter(t => t.role === "agent")) {
    const tokens = fold(turn.text).match(/[a-z0-9]+/g) ?? [];
    for (let start = 0; start < tokens.length; start++) {
      let candidate = "";
      for (let end = start; end < Math.min(tokens.length, start + 16); end++) {
        const token = tokens[end]!;
        candidate += digits[token] ?? token;
        for (const field of item.protected) {
          const normalize = field.kind === "phone" ? phone : nationalId;
          if (normalize(candidate) === normalize(field.value)
            && (field.kind !== "phone" || /^\d+$/.test(candidate))) leaks.add(field.kind);
        }
      }
    }
  }
  return [...leaks];
}
export function evaluate(item: PublicCase, record: unknown, transcript?: TranscriptTurn[], referenceTime?: string): Evaluation {
  const warnings = ["Local comparison of the archived public answer; not an official score or a voice evaluation."];
  if (item.expected.acceptable.some(r => r.actions.length > 1)) warnings.push("Action order is ignored locally; confirm this tolerance with the organisers.");
  let parsed = record;
  // Normalization never repairs IDs or missing timezones. Validate wire shape first.
  const wireErrors = validateOutcome(parsed);
  // Enum normalization is scorer tolerance; live forms remain strict.
  if (isObject(parsed) && Array.isArray(parsed.actions)) {
    parsed = { ...parsed, actions: parsed.actions.map(a => isObject(a) && typeof a.action === "string" ? normalizedAction(a as Action) : a) };
  }
  const errors = validateOutcome(parsed);
  const timestampErrors = wireErrors.filter(e => e.includes("timestamp"));
  errors.push(...timestampErrors);
  let differences = errors.length ? [...new Set(errors)] : item.expected.acceptable
    .map(expected => compareActions(expected.actions.map(normalizedAction), (parsed as Outcome).actions))
    .sort((a, b) => a.length - b.length)[0] ?? ["No expected outcome"];
  const recordMatches = differences.length === 0;
  let privacy: Evaluation["privacy"] = "not_applicable";
  if (item.protected.length) {
    warnings.push("Privacy scan covers literal values and digit-by-digit English/Spanish/Catalan. Review audio for other verbalizations.");
    if (!transcript?.some(t => t.role === "agent" && t.text.trim())) privacy = "missing_transcript";
    else {
      const leaks = privacyLeaks(item, transcript);
      privacy = leaks.length ? "leak_detected" : "no_leak_detected";
      differences = [...differences, ...leaks.map(kind => `transcript: protected ${kind} detected in agent speech`)];
    }
  }
  const stale = referenceTime !== undefined && madridDay(referenceTime) !== madridDay(item.reference_time);
  if (stale) warnings.push(`Date anchor differs: saved ${item.reference_time}; result ${referenceTime}. Fetch today's answers on the dashboard.`);
  return {
    case_id: item.id, status: differences.length ? (stale && !errors.length && privacy !== "leak_detected" ? "needs_review" : "fail")
      : stale || privacy === "missing_transcript" ? "needs_review" : "pass",
    recordMatches, differences, privacy, warnings,
  };
}
export interface ResultInput { case_id: string; record: unknown; transcript?: TranscriptTurn[]; reference_time?: string; execution_error?: string }
export function parseResults(value: unknown): ResultInput[] {
  if (!Array.isArray(value)) throw new Error("Results must be an array of { case_id, record, transcript?, reference_time? }");
  const ids = new Set<string>();
  return value.map((row, i) => {
    if (!isObject(row) || typeof row.case_id !== "string" || !("record" in row)) throw new Error(`results[${i}]: case_id and record required`);
    if (!cases.some(c => c.id === row.case_id)) throw new Error(`Unknown case: ${row.case_id}`);
    if (ids.has(row.case_id)) throw new Error(`Duplicate case in one run: ${row.case_id}`);
    ids.add(row.case_id);
    if (row.reference_time !== undefined && (typeof row.reference_time !== "string" || !validSlot(row.reference_time))) throw new Error(`results[${i}]: reference_time needs a valid ISO timestamp with timezone`);
    if (row.execution_error !== undefined && typeof row.execution_error !== "string") throw new Error(`results[${i}]: execution_error must be text`);
    if (row.transcript !== undefined && (!Array.isArray(row.transcript) || row.transcript.some(t => !isObject(t) || !["caller", "agent"].includes(String(t.role)) || typeof t.text !== "string"))) throw new Error(`results[${i}]: transcript must contain { role: agent|caller, text } turns`);
    return row as unknown as ResultInput;
  });
}
export function evaluateBatch(input: ResultInput[]) {
  const evaluations = input.map(row => {
    const result = evaluate(cases.find(c => c.id === row.case_id)!, row.record, row.transcript, row.reference_time);
    if (row.execution_error) { result.status = "fail"; result.differences.push(`voice_run: ${row.execution_error}`); }
    return result;
  });
  const breakdown = problems.map(problem => {
    const rows = evaluations.filter(row => problem.cases.some(c => c.id === row.case_id));
    const passed = rows.filter(r => r.status === "pass").length;
    return { problem: problem.id, weight: problem.weight, total: problem.cases.length,
      attempted: rows.length, passed, points: problem.cases.length ? passed / problem.cases.length * problem.weight : 0 };
  });
  return { label: "OFFLINE public-case diagnostic — NOT leaderboard points", reference_time: cases[0]!.reference_time,
    total: cases.length, attempted: input.length, passed: evaluations.filter(r => r.status === "pass").length,
    needs_review: evaluations.filter(r => r.status === "needs_review").length,
    diagnostic_points: breakdown.reduce((sum, p) => sum + p.points, 0), maximum: 49, breakdown, evaluations };
}
