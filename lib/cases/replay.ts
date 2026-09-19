import { getPublicCase, loadPublicCases } from "@/lib/cases/load";
import { normalizeNationalId, normalizeSlot } from "@/lib/cases/score";
import type { CaseCheck, CaseRunResult, PublicCase } from "@/lib/cases/types";
import { getClinicSource, type ClinicConnection } from "@/lib/clinic/source";
import type { ClinicSource, PatientMatch } from "@/lib/clinic/types";
import { clinicTodayYmd, diffYmd, shiftIsoDays } from "@/lib/time";

function shiftFor(item: PublicCase) {
  return diffYmd(item.reference_time.slice(0, 10), clinicTodayYmd());
}

function firstActions(item: PublicCase) {
  return item.expected.acceptable[0]?.actions ?? [];
}

async function lookupPatient(source: ClinicSource, item: PublicCase): Promise<{
  matches: PatientMatch[];
  error?: string;
}> {
  const data = item.persona.data;
  const nationalId = data.patient_national_id || data.national_id;
  const phone = data.patient_phone || data.phone || data.caller_phone || item.persona.phone;
  try {
    if (nationalId) {
      const byId = await source.directory({ national_id: nationalId });
      if (byId.matches.length) return { matches: byId.matches };
    }
    if (phone) {
      const byPhone = await source.directory({ phone });
      if (byPhone.matches.length) return { matches: byPhone.matches };
    }
    const name =
      [data.patient_given_name ?? data.given_name, data.patient_first_surname ?? data.first_surname, data.patient_second_surname ?? data.second_surname]
        .filter(Boolean)
        .join(" ") || data.patient_full_name || item.persona.name;
    if (name) {
      const byName = await source.directory({
        name,
        date_of_birth: data.patient_date_of_birth ?? data.date_of_birth,
      });
      return { matches: byName.matches };
    }
    return { matches: [] };
  } catch (error) {
    return {
      matches: [],
      error: error instanceof Error ? error.message : "directory failed",
    };
  }
}

async function runOne(source: ClinicSource, item: PublicCase): Promise<CaseRunResult> {
  const actions = firstActions(item);
  const verbs = actions.map((action) => action.action);
  const checks: CaseCheck[] = [];
  const lookup = await lookupPatient(source, item);
  const data = item.persona.data;
  const wantsRegister = verbs.includes("REGISTER");
  const wantsBook = verbs.includes("BOOK") || verbs.includes("RESCHEDULE");
  const wantsDiary = verbs.includes("CANCEL") || verbs.includes("RESCHEDULE");

  if (lookup.error) {
    checks.push({ name: "directory", ok: false, detail: lookup.error });
  } else if (wantsRegister) {
    checks.push({
      name: "directory",
      ok: lookup.matches.length === 0,
      detail:
        lookup.matches.length === 0
          ? "No chart on file (REGISTER)"
          : `Found ${lookup.matches.length} match(es); REGISTER cases should be unknown`,
    });
  } else if (verbs.every((verb) => verb === "NO_ACTION" || verb === "ESCALATE") && !item.persona.data.national_id) {
    checks.push({
      name: "directory",
      ok: true,
      detail: "No identification required for this outcome",
    });
  } else {
    const expectedPatient = actions.find((action) => typeof action.patient_id === "string") as
      | { patient_id: string }
      | undefined;
    const expectedNid = data.patient_national_id || data.national_id;
    const hit = expectedPatient
      ? lookup.matches.some((match) => match.patient_id === expectedPatient.patient_id)
      : lookup.matches.length > 0;
    const idMatch = expectedNid
      ? lookup.matches.some(
          (match) => normalizeNationalId(match.national_id) === normalizeNationalId(expectedNid),
        )
      : lookup.matches.length > 0;
    checks.push({
      name: "directory",
      ok: Boolean(hit || idMatch),
      detail: lookup.matches.length
        ? `Matched ${lookup.matches.map((match) => match.patient_id).join(", ")}`
        : "No directory match",
    });
  }

  if (wantsBook) {
    const book =
      actions.find((action) => action.action === "BOOK") ??
      actions.find((action) => action.action === "RESCHEDULE");
    if (book && typeof book.slot === "string") {
      const shift = shiftFor(item);
      const slot = shiftIsoDays(book.slot, shift);
      const day = slot.slice(0, 10);
      try {
        const availability = await source.availability({
          date_from: day,
          date_to: day,
          patient_id: typeof book.patient_id === "string" ? book.patient_id : undefined,
          provider_id: typeof book.provider_id === "string" ? book.provider_id : undefined,
          location_id: typeof book.location_id === "string" ? book.location_id : undefined,
        });
        const found = availability.slots.some(
          (itemSlot) =>
            normalizeSlot(itemSlot.start_time) === normalizeSlot(slot) &&
            itemSlot.provider_id === book.provider_id &&
            itemSlot.location_id === book.location_id,
        );
        checks.push({
          name: "availability",
          ok: found || availability.slots.length > 0,
          detail: found
            ? `Expected slot ${slot} is offered`
            : availability.slots[0]
              ? `Expected ${slot}; soonest offered ${availability.slots[0].start_time}`
              : `No slots on ${day}${availability.blocked?.length ? `; blocked ${availability.blocked.map((row) => row.restriction).join(", ")}` : ""}`,
        });
      } catch (error) {
        checks.push({
          name: "availability",
          ok: false,
          detail: error instanceof Error ? error.message : "availability failed",
        });
      }
    }
  }

  if (wantsDiary) {
    const appointmentId = actions.find((action) => typeof action.appointment_id === "string") as
      | { appointment_id: string }
      | undefined;
    const patientId =
      (
        actions.find(
          (action) =>
            (action.action === "CANCEL" || action.action === "RESCHEDULE") &&
            typeof action.patient_id === "string",
        ) as { patient_id: string } | undefined
      )?.patient_id ?? lookup.matches[0]?.patient_id;
    if (patientId && appointmentId) {
      try {
        const diary = await source.appointments(patientId, "upcoming");
        const found = diary.appointments.some(
          (row) => row.appointment_id === appointmentId.appointment_id,
        );
        checks.push({
          name: "appointments",
          ok: found || diary.appointments.length > 0,
          detail: found
            ? `Found ${appointmentId.appointment_id}`
            : `Listed ${diary.appointments.length} upcoming appointment(s)`,
        });
      } catch (error) {
        checks.push({
          name: "appointments",
          ok: false,
          detail: error instanceof Error ? error.message : "appointments failed",
        });
      }
    }
  }

  if (verbs.includes("NO_ACTION") || verbs.includes("ESCALATE")) {
    const reason = actions.find((action) => typeof action.reason === "string") as
      | { reason: string }
      | undefined;
    checks.push({
      name: "outcome",
      ok: true,
      detail: `Expected ${verbs.join("+")}${reason ? ` (${reason.reason})` : ""}`,
    });
  }

  return {
    caseId: item.id,
    problemId: item.problem_id,
    summary: item.summary,
    language: item.language,
    expectedActions: verbs,
    checks,
    passed: checks.length > 0 && checks.every((check) => check.ok),
  };
}

export async function runPublicCases(options?: {
  ids?: string[];
  connection?: ClinicConnection;
  concurrency?: number;
}): Promise<{ source: ClinicSource["info"]; results: CaseRunResult[] }> {
  const source = getClinicSource(options?.connection);
  const selected = options?.ids?.length
    ? options.ids
        .map((id) => getPublicCase(id))
        .filter((item): item is PublicCase => Boolean(item))
    : loadPublicCases();

  const concurrency = options?.concurrency ?? 5;
  const results: CaseRunResult[] = [];
  for (let i = 0; i < selected.length; i += concurrency) {
    const slice = selected.slice(i, i + concurrency);
    results.push(...(await Promise.all(slice.map((item) => runOne(source, item)))));
  }
  return { source: source.info, results };
}
