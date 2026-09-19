const SECRET_KEY = /authorization|api.?key|secret|token|password|signed.?url/i;
const PERSONAL_KEY = /^(phone|from_?number|to|from|email|dni|nie|national_id|dob|date_of_birth|birth_?date|given_name|first_surname|second_surname|name|patient_?name|patient_?id|patient|transcript|text|user_transcript|agent_response|note|summary|url|directory_hint)$/i;

/** Retain action metadata while honoring the call's existing zero-retention setting. */
export function auditPayload(value: unknown, zeroRetention: boolean): unknown {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_KEY.test(key) || (zeroRetention && PERSONAL_KEY.test(key))) url.searchParams.set(key, "[redacted]");
      }
      return url.toString();
    } catch { return "[invalid URL]"; }
  }
  if (Array.isArray(value)) return value.map((item) => auditPayload(item, zeroRetention));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY.test(key) || (zeroRetention && PERSONAL_KEY.test(key))
      ? "[redacted]"
      : auditPayload(item, zeroRetention),
  ]));
}
