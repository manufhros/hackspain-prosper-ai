import { type Outcome } from "../data";
import { isObject, requestForAction, validateOutcome } from "../validation";

/** Normalize envelope differences only; never invent or repair action fields. */
export function completionRecord(args: unknown): Outcome {
  const decode = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : value;
  let value = decode(args);
  if (isObject(value) && Object.keys(value).length === 1 && "record" in value) value = decode(value.record);
  if (Array.isArray(value)) value = { actions: value };
  else if (isObject(value) && typeof value.action === "string") value = { actions: [value] };
  const errors = validateOutcome(value);
  if (errors.length) throw new Error(`${errors.join("; ")}. Call complete_call with {"actions":[{"action":"BOOK",...all required fields}]}; use the appropriate verb for every final intent. Repair the payload, not the caller's confirmation.`);
  return structuredClone(value as Outcome);
}

/** A preview only: an official submission must use the carrier's real callSid. */
export function simulatedSubmission(record: Outcome) {
  return {
    accepted_locally: true as const,
    platform_submission: false as const,
    record: structuredClone(record),
    submission_preview: record.actions.map(action => ({ method: "POST" as const, ...requestForAction(action, "<start.callSid>") })),
  };
}

export function completionSpeech(language: string): string {
  return ({
    en: "I've recorded the outcome of this simulation. Thank you for calling. Goodbye.",
    es: "He guardado el resultado de esta simulación. Gracias por llamar. Hasta luego.",
    ca: "He desat el resultat d'aquesta simulació. Gràcies per trucar. Fins aviat.",
  } as Record<string, string>)[language] ?? "I've recorded the outcome of this simulation. Thank you for calling. Goodbye.";
}
