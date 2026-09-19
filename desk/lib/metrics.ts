import fromLogs from "./from-logs.json";
import { ORGS } from "./orgs";
import type { LoggedCall, Org, Source } from "./types";

const liveCalls = fromLogs.calls as LoggedCall[];

const DEMO_SCALE: Record<string, number> = {
  quironsalud: 28,
  sanitas: 16,
};

function hash(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

function demoCalls(org: Org): LoggedCall[] {
  const scale = DEMO_SCALE[org.slug] ?? 4;
  const motives = [
    "Medicina general",
    "Traumatología",
    "Ginecología",
    "Dermatología",
    "Pediatría",
    "Cardiología",
    "Revisión",
  ];
  const out: LoggedCall[] = [];
  org.hospitals.forEach((hospital, hi) => {
    const n = Math.max(18, Math.round((liveCalls.length / org.hospitals.length) * (scale / 8) + hi * 7));
    for (let i = 0; i < n; i++) {
      const seed = hash(`${org.slug}:${hospital.id}:${i}`);
      const outcomes = ["cita", "cita", "cita", "cita", "alta", "cita", "sin_cita", "sin_cierre", "escalado"] as const;
      const outcome = outcomes[seed % outcomes.length];
      out.push({
        id: `demo-${org.slug}-${hospital.id}-${i}`,
        phone: null,
        started: "2026-09-19T10:00:00 CEST",
        minutes: 3 + (seed % 5),
        patient: null,
        patientId: null,
        insurer: ["sanitas", "adeslas", "dkv", "mapfre"][seed % 4],
        site: hospital.id,
        siteName: hospital.name,
        outcome,
        reason: outcome === "escalado" ? "medical_emergency" : null,
        motive: motives[(seed >>> 3) % motives.length],
        slot: outcome === "cita" ? "2026-09-22T09:30:00+02:00" : null,
        providerId: null,
        source: "demo",
        sourceFile: null,
        resolution: outcome === "escalado" ? "escalated" : outcome === "sin_cierre" ? "abandoned" : "resolved",
        route: outcome === "escalado" ? "human" : "actions",
        intent: outcome === "cita" ? "appointment_action" : "general_faq",
        toolCalls: 2 + (seed % 4),
        toolErrors: seed % 11 === 0 ? 1 : 0,
        avgToolLatencyMs: 180 + (seed % 420),
        frustrationScore: outcome === "escalado" ? 72 + (seed % 20) : seed % 38,
        sentiment: null,
        patientRating: null,
        escalationAppropriate: outcome === "escalado" ? true : null,
        configVersion: "demo",
        actions: [],
      });
    }
  });
  return out;
}

export function callsFor(org: Org): LoggedCall[] {
  if (org.source === "llamadas") return liveCalls;
  return demoCalls(org);
}

export function filterSite(calls: LoggedCall[], site?: string): LoggedCall[] {
  if (!site) return calls;
  return calls.filter((call) => call.site === site);
}

import { pitch } from "./sales";

export function moneySaved(calls: LoggedCall[]): number {
  return pitch(calls).deskYear;
}

export function lineMinutes(calls: LoggedCall[]): number {
  return calls.reduce((sum, call) => sum + call.minutes, 0);
}

export function qualityMetrics(calls: LoggedCall[]) {
  const withLatency = calls.filter((call) => call.avgToolLatencyMs != null);
  const ratings = calls
    .map((call) => call.patientRating)
    .filter((rating): rating is number => typeof rating === "number");
  const escalated = calls.filter((call) => call.outcome === "escalado");
  const appropriate = escalated.filter((call) => call.escalationAppropriate === true);
  const toolCalls = calls.reduce((sum, call) => sum + (call.toolCalls ?? 0), 0);
  const toolErrors = calls.reduce((sum, call) => sum + (call.toolErrors ?? 0), 0);
  return {
    autonomousRate: calls.length
      ? Math.round((calls.filter((call) => call.resolution === "resolved").length / calls.length) * 100)
      : 0,
    frustration: calls.length
      ? Math.round(calls.reduce((sum, call) => sum + (call.frustrationScore ?? 0), 0) / calls.length)
      : 0,
    avgLatencyMs: withLatency.length
      ? Math.round(
          withLatency.reduce((sum, call) => sum + (call.avgToolLatencyMs ?? 0), 0) /
            withLatency.length,
        )
      : null,
    toolErrorRate: toolCalls ? Math.round((toolErrors / toolCalls) * 100) : 0,
    escalationQuality: escalated.length
      ? Math.round((appropriate.length / escalated.length) * 100)
      : 100,
    patientRating: ratings.length
      ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
      : null,
  };
}

export function byHospital(calls: LoggedCall[]) {
  const map = new Map<string, { name: string; calls: number; citas: number; minutes: number }>();
  for (const call of calls) {
    const key = call.site ?? "none";
    const row = map.get(key) ?? { name: call.siteName, calls: 0, citas: 0, minutes: 0 };
    row.calls += 1;
    if (call.outcome === "cita") row.citas += 1;
    row.minutes += call.minutes;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.citas - a.citas);
}

export function byOutcome(calls: LoggedCall[]) {
  const map = new Map<string, number>();
  for (const call of calls) map.set(call.outcome, (map.get(call.outcome) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function consultationType(motive: string): string {
  const value = motive.toLowerCase();
  if (/trauma|ortho|hombro|espalda|rodilla|caída/.test(value)) return "Traumatología";
  if (/gine|contrace|embarazo/.test(value)) return "Ginecología";
  if (/derma|piel|skin|lunar/.test(value)) return "Dermatología";
  if (/pedi|niñ|child/.test(value)) return "Pediatría";
  if (/cardio|pecho|chest|corazón/.test(value)) return "Cardiología";
  if (/revisión|review|seguimiento/.test(value)) return "Revisión";
  if (/general|tos|cough|fiebre|fever/.test(value)) return "Medicina general";
  return "Otras consultas";
}

export function byConsultation(calls: LoggedCall[]) {
  const map = new Map<string, number>();
  for (const call of calls) {
    const type = consultationType(call.motive);
    map.set(type, (map.get(type) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function patientsFrom(calls: LoggedCall[]) {
  const map = new Map<string, { name: string; insurer: string | null; calls: number; last: string | null }>();
  for (const call of calls) {
    const key = call.patientId ?? call.patient ?? call.id;
    const name = call.patient || "Sin identificar en el log";
    const row = map.get(key) ?? { name, insurer: call.insurer, calls: 0, last: call.started };
    row.calls += 1;
    if (call.insurer) row.insurer = call.insurer;
    row.last = call.started ?? row.last;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

export const OUTCOME_LABEL: Record<string, string> = {
  cita: "Cita hecha",
  alta: "Alta de paciente",
  escalado: "Pasado a persona",
  sin_cita: "Sin cita (norma o hueco)",
  cancelacion: "Cita anulada",
  cambio: "Cambio de hora",
  sin_cierre: "Colgó sin cierre",
};

export function sourceOfOrg(slug: string): Source {
  return ORGS.find((org) => org.slug === slug)?.source ?? "demo";
}

export function allOrgSummaries() {
  return ORGS.map((org) => {
    const calls = callsFor(org);
    return {
      org,
      calls: calls.length,
      citas: calls.filter((c) => c.outcome === "cita").length,
      saved: moneySaved(calls),
      minutes: lineMinutes(calls),
    };
  });
}
