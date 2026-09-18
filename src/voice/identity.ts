import { fold, phone, validDate } from "../validation";
import { type ObjectValue } from "../data";

const words = (value: string) => fold(value).replace(/[^a-z0-9]+/g, " ").trim();
const compact = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");
const months = ["january enero gener", "february febrero febrer", "march marzo marc", "april abril", "may mayo maig", "june junio juny",
  "july julio juliol", "august agosto agost", "september septiembre setembre", "october octubre", "november noviembre novembre", "december diciembre desembre"];

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
  return turns.some(text => new RegExp(`(?:^|[^0-9])${expected}(?![0-9])`).test(compact(text)));
}

export function verifiedPatient(patient: ObjectValue, query: ObjectValue, turns: string[]): boolean {
  if (!callerSupplied("name", query.name, turns)) return false;
  const name = ` ${words(String(query.name))} `;
  // Fuzzy directory results alone cannot establish identity. Ask for spelling if needed.
  if (![patient.given_name, patient.first_surname].every(part => typeof part === "string" && name.includes(` ${words(part)} `))) return false;
  const fields = ["national_id", "phone", "date_of_birth"].filter(field => query[field] != null);
  return fields.length > 0 && fields.every(field => {
    if (!callerSupplied(field, query[field], turns) || typeof patient[field] !== "string") return false;
    return field === "phone" ? phone(String(query[field])) === phone(String(patient[field]))
      : compact(String(query[field])) === compact(String(patient[field]));
  });
}
