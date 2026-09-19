import { fold, phone, validDate } from "../validation";
import { type ObjectValue } from "../data";

const words = (value: string) => fold(value).replace(/[^a-z0-9]+/g, " ").trim();
const compact = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");
const months = ["january enero gener", "february febrero febrer", "march marzo marc", "april abril", "may mayo maig", "june junio juny",
  "july julio juliol", "august agosto agost", "september septiembre setembre", "october octubre", "november noviembre novembre", "december diciembre desembre"];

function suppliedNationalId(text: string, expected: string): boolean {
  // Consume the entire numeric run, so an extra digit cannot become a matching suffix.
  // Only explicit letter introductions may bridge digits and the final letter;
  // never infer a missing letter or join evidence across different caller turns.
  const letter = "(?:(?:y )?(?:la )?letra(?: final)?(?: es)?|(?:and )?(?:the )?(?:final )?letter(?: is)?|(?:i )?(?:la )?lletra(?: final)?(?: es)?)";
  const candidates = new RegExp(`\\b([xyz] ?)?(\\d(?: ?\\d)*)(?: ${letter} )? ?([a-z])\\b`, "g");
  return [...words(text).matchAll(candidates)].some(match => compact(`${match[1] ?? ""}${match[2]}${match[3]}`) === expected);
}

function suppliedBirthDate(text: string, date: string): boolean {
  if (!validDate(date)) return false;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const value = words(text);
  if (new RegExp(`\\b${year} ${String(month).padStart(2, "0")} ${String(day).padStart(2, "0")}\\b`).test(value)) return true;
  // Numeric dates with an ambiguous month/day order require the caller to spell the month.
  if (day > 12 && new RegExp(`\\b0?${day} 0?${month} ${year}\\b`).test(value)) return true;
  return months[month - 1]!.split(" ").some(name => new RegExp(`\\b(?:0?${day}(?:st|nd|rd|th)? (?:de )?${name}(?: de)? ${year}|${name} 0?${day}(?:st|nd|rd|th)? ${year})\\b`).test(value));
}

/** Identity evidence must originate in caller turns, never caller ID or a tool result. */
export function callerSupplied(field: string, value: unknown, turns: string[]): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (field === "name") return turns.some(text => ` ${words(text)} `.includes(` ${words(value)} `));
  if (field === "date_of_birth") return turns.some(text => suppliedBirthDate(text, value));
  const expected = field === "phone" ? phone(value) : compact(value);
  if (!expected || (field === "phone" && expected.length !== 9)) return false;
  if (field === "national_id") return turns.some(text => suppliedNationalId(text, expected));
  return turns.some(text => new RegExp(`(?:^|[^0-9])${field === "phone" ? "(?:0034|34)?" : ""}${expected}(?![0-9])`).test(compact(text)));
}

export function exactIdentifiersMatch(patient: ObjectValue, query: ObjectValue, turns: string[]): boolean {
  const fields = ["national_id", "phone", "date_of_birth"].filter(field => query[field] != null);
  return fields.length > 0 && fields.every(field => {
    if (!callerSupplied(field, query[field], turns) || typeof patient[field] !== "string") return false;
    return field === "phone" ? phone(String(query[field])) === phone(String(patient[field]))
      : compact(String(query[field])) === compact(String(patient[field]));
  });
}

function oneEdit(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function verifiedPatient(patient: ObjectValue, query: ObjectValue, turns: string[]): boolean {
  if (!callerSupplied("name", query.name, turns) || !exactIdentifiersMatch(patient, query, turns)) return false;
  if (typeof patient.given_name !== "string" || typeof patient.first_surname !== "string") return false;
  const given = compact(patient.given_name), first = compact(patient.first_surname);
  const second = typeof patient.second_surname === "string" ? compact(patient.second_surname) : "";
  const name = compact(String(query.name));
  if (!given || !first || !name.startsWith(given)) return false;
  const surnames = name.slice(given.length);
  // Ignore ASR spacing/hyphens and surname order, but never an extra conflicting name.
  if ([first, first + second, second + first].includes(surnames)) return true;
  // A fuzzy API score is not identity. Only an exact, caller-supplied DNI/NIE
  // enables one surname edit; the given name and other surname must be exact.
  if (query.national_id == null || !second) return false;
  return [[first, second], [second, first]].some(([a, b]) =>
    (surnames.startsWith(a!) && oneEdit(surnames.slice(a!.length), b!))
    || (surnames.endsWith(b!) && oneEdit(surnames.slice(0, -b!.length), a!)));
}
