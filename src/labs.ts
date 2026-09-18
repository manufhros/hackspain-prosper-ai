import { cases, problems } from "./data";
import { CallSession, inspectTrace, wireMessages } from "./protocol";
import { madridDay, validSlot } from "./validation";

export const labDescriptions = [
  { id: "contract", title: "Submission contract", text: "Exercise receipt, duplicates, wrong call IDs, malformed actions and the 30-second deadline entirely in memory. This checks the workbench simulator, not your agent." },
  { id: "trace", title: "Inspect a wire trace", text: "Import an array of { connection, message } inbound Twilio events. Checks sequencing, call IDs, 8 kHz mu-law format, 20 ms frames and cross-socket contamination." },
  { id: "burst", title: "Probe an existing endpoint", text: "Open 1 / 5 / 10 / 20 WebSockets to your already-running agent. Sends connected/start, 1 second of silence, then stop after a 5-second observation. Transport only: no caller conversation or scheduling evaluation. Synthetic call IDs must never be submitted to Prosper. An agent may consume provider credits on connection." },
  { id: "date", title: "Resolve a relative date", text: "Enter the call's connection time (explicit offset) and a phrase from problem 5. Resolves in Europe/Madrid, with weekdays strictly after the call. Reports closure rules; availability must still be queried." },
  { id: "dni", title: "Check a DNI / NIE", text: "Check the full national ID, including its derived letter. Does not repair a misheard digit or invent an ID." },
  { id: "nearest", title: "Rank eligible sites", text: "Use your origin coordinates and an imported array of eligible clinic sites: { id, latitude, longitude }. Filter eligibility using real availability first. Ranks by straight-line great-circle distance; does not geocode addresses." },
  { id: "readiness", title: "Track & jury readiness", text: "The implementation and live evidence needed across all 18 problems, the voice pipeline, platform integration, and jury demonstration. The workbench is a test tool; it does not complete these capabilities for you." },
];
export function contractDiagnostics() {
  const call = new CallSession("from-start-callSid");
  const action = { action: "CANCEL", appointment_id: "A123" };
  const checks = [
    { check: "unknown call", expected: 404, actual: call.submit("wrong-id", action, 0) },
    { check: "malformed body", expected: 422, actual: call.submit(call.callId, { action: "BOOK" }, 0) },
    { check: "early receipt", expected: 200, actual: call.submit(call.callId, action, 0) },
    { check: "duplicate", expected: 409, actual: call.submit(call.callId, action, 1) },
  ];
  call.close(1000);
  checks.push({ check: "exactly +30 seconds", expected: 200, actual: call.submit(call.callId, { action: "CANCEL", appointment_id: "A456" }, 31000) });
  checks.push({ check: "deadline before duplicate", expected: 410, actual: call.submit(call.callId, action, 31001) });
  const streams = Array.from({ length: 20 }, (_, i) => wireMessages(`call-${i}`, `stream-${i}`));
  const trace = ["connected", "start", "media", "stop"].flatMap(stage => streams.map((wire, i) => ({
    connection: String(i), message: stage === "connected" ? wire.connected : stage === "start" ? wire.start : stage === "media" ? wire.media(0) : wire.stop(1),
  })));
  return { label: "WORKBENCH SELF-CHECK — not agent performance", checks, simulated_connections: inspectTrace(trace),
    okay: checks.every(c => c.actual === c.expected) && inspectTrace(trace).valid };
}
export function resolveRelativeDate(phrase: string, reference: string) {
  if (!validSlot(reference)) throw new Error("Call reference must be an ISO timestamp with timezone offset");
  const day = madridDay(reference);
  const date = new Date(`${day}T12:00:00Z`);
  const text = phrase.trim().toLowerCase();
  let offset: number;
  let part = "any";
  const fixed: Record<string, number> = { tomorrow: 1, "the day after tomorrow": 2, "a week from today": 7, "in a fortnight": 14 };
  if (text === "first thing on monday the twelfth of october") {
    date.setUTCFullYear(2026, 9, 12); offset = 0; part = "morning";
  } else if (text in fixed) offset = fixed[text]!;
  else {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const match = /^(?:this coming |first thing )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: afternoon)?$/.exec(text);
    const target = text === "on saturday morning" ? 6 : match ? weekdays.indexOf(match[1]!) : -1;
    if (target < 0) throw new Error("Use the exact published vocabulary from task/problems.md, problem 5");
    offset = (target - date.getUTCDay() + 7) % 7 || 7;
    if (text.startsWith("first thing") || text.endsWith("morning")) part = "morning";
    if (text.endsWith("afternoon")) part = "afternoon";
  }
  date.setUTCDate(date.getUTCDate() + offset);
  const resolved = date.toISOString().slice(0, 10);
  return { call_day_madrid: day, requested_day: resolved, part_of_day: part,
    closure: resolved === "2026-10-12" ? "Fiesta Nacional: all sites closed" : date.getUTCDay() === 0 ? "Sunday: all sites closed"
      : date.getUTCDay() === 6 ? "Saturday: only Centro opens" : date.getUTCDay() === 5 ? "Friday: Sur shuts at lunchtime" : "Check site and provider schedules",
    within_calendar_after_call: resolved > day && resolved >= "2026-09-07" && resolved <= "2026-10-16",
    next_step: "Query real availability; preserve the site and time-of-day constraints if the caller accepts a later open day. Morning <14:00; afternoon >=14:00."
  };
}
export function rankSites(latitude: number, longitude: number, sites: { id: string; latitude: number; longitude: number }[]) {
  const valid = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!valid(latitude, longitude) || !Array.isArray(sites) || sites.some(s => !s || typeof s.id !== "string" || !valid(s.latitude, s.longitude))) throw new Error("Provide valid coordinates and eligible sites with id/latitude/longitude");
  const rad = (n: number) => n * Math.PI / 180;
  return sites.map(site => {
    const a = Math.sin(rad(site.latitude - latitude) / 2) ** 2
      + Math.cos(rad(latitude)) * Math.cos(rad(site.latitude)) * Math.sin(rad(site.longitude - longitude) / 2) ** 2;
    return { ...site, distance_km: 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) };
  }).sort((a, b) => a.distance_km - b.distance_km);
}
export function readiness(): string {
  return [
    "BUILD & REHEARSE", "",
    "1. Desk-issued team account, dashboard password, API key and EUR100 budget.",
    "2. Provider-neutral agent still to build: per-call STT / reasoning / TTS, 8 kHz mu-law audio and local interruption handling. Clear does not stop harness playback.",
    "3. Identify patient using two fields; caller ID is only a hint. Read the note and visit history, distinguish caller from patient.",
    "4. Use real clinic, directory, availability and upcoming appointment IDs. Ask about a second insurance policy; never invent self-pay.",
    "5. Submit every final intent, with explicit reason when refusing. Save start.callSid, submit before close +30 seconds; receipt is not a verdict.",
    "6. User starts agent and tunnel. Set wss://host/path and optional headers in dashboard Settings > Integration.",
    "7. Dashboard Problems > Call for practice. 30s between practices; one active/queued run. Switchboard bursts: 5, 10, 20.",
    "8. Dashboard Run All: 10 parallel calls; 4 private cases per open scored problem. 15 min after previous Run All finishes. Best run counts.",
    "", "ALL 18 CAPABILITIES (live proof still required)",
    ...problems.map(p => `${String(p.number).padStart(2)}. ${p.name} — ${p.cases.length} archived cases, ${p.weight || "diagnostic"} weight`),
    "", "JURY DEMO", "Natural speech and latency; interruption and corrections; chart-aware personalization; Spanish/Catalan and code-switching; safety and privacy; concurrent-call observability; explanations, repeated-run variance, cost and duration.",
    "", "ARCHIVE LIMITS", `${cases.length} cases anchored at ${cases[0]!.reference_time}. Answers move daily. Open flags are a snapshot, not live status.`,
    "Docs disagree about starter kit existence and whether harness failures exclude cases or void the whole run. Quickstart says no kit; detailed rules say void. Confirm with organisers.",
    "Archived wall freeze: Sunday 20 September 06:00 Europe/Madrid. Private transcripts/audio reveal: Monday 21 September 00:00; private expected answers never published.",
    "Practice/Run All/settings/recordings APIs are absent from the public schema. Use the dashboard; no guessed endpoints.",
  ].join("\n");
}
