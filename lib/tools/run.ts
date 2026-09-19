import { clinicTodayYmd } from "@/lib/time";
import { getClinicSource } from "@/lib/clinic/source";
import { explainTool } from "@/lib/tools/catalog";
import type { TranscriptTurn } from "@/lib/cases/transcript";

function ymd(offset: number) {
  const date = new Date(`${clinicTodayYmd()}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function locationOf(input: Record<string, string>) {
  const blob = Object.values(input).join(" ").toLowerCase();
  if (/\bnorte\b/.test(blob) || input.location_id === "norte") return "norte";
  if (/\bsur\b/.test(blob) || input.location_id === "sur") return "sur";
  if (/\bcentro\b/.test(blob) || input.location_id === "centro") return "centro";
  return input.location_id;
}

function specialtyOf(input: Record<string, string>) {
  const blob = `${input.specialty_id ?? ""} ${Object.values(input).join(" ")}`.toLowerCase();
  if (/pedia|paed/.test(blob)) return "paediatrics";
  if (/derm/.test(blob)) return "dermatology";
  if (/gine|gyn/.test(blob)) return "gynaecology";
  if (/traum|ortho/.test(blob)) return "orthopaedics";
  if (/fisio|physio/.test(blob)) return "physiotherapy";
  if (/general|gp|medicina/.test(blob)) return "general_practice";
  return input.specialty_id;
}

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

export async function enrichToolTurns(turns: TranscriptTurn[]): Promise<TranscriptTurn[]> {
  const source = getClinicSource();
  const next: TranscriptTurn[] = [];
  for (const turn of turns) {
    if (turn.kind !== "tool") {
      next.push(turn);
      continue;
    }
    const info = explainTool(turn.name, turn.reason);
    const input = turn.input ?? {};
    try {
      let result = turn.result;
      if (info.name === "search_directory") {
        const data = await source.directory({
          name: input.name ?? input.nombre ?? input.criterio,
          national_id: input.national_id ?? input.dni,
          phone: input.phone ?? input.telefono,
        });
        result =
          data.matches.length === 0
            ? "Sin pacientes"
            : data.matches
                .slice(0, 4)
                .map((match) => `${match.given_name} ${match.first_surname} · ${match.national_id}`.trim())
                .join("; ");
      } else if (info.name === "search_availability") {
        const data = await source.availability({
          date_from: input.date_from ?? ymd(1),
          date_to: input.date_to ?? ymd(14),
          location_id: locationOf(input),
          specialty_id: specialtyOf(input),
        });
        result =
          data.slots.length === 0
            ? "Sin huecos en esa ventana"
            : `${data.slots.length} huecos. Primero: ${data.slots[0]?.start_time} · ${data.slots[0]?.location_id}`;
      } else if (info.name === "list_appointments") {
        const patientId = input.patient_id ?? input.criterio;
        if (!patientId) result = "Falta patient_id";
        else {
          const data = await source.appointments(patientId, "upcoming");
          result =
            data.appointments.length === 0
              ? "Sin citas próximas"
              : data.appointments
                  .slice(0, 3)
                  .map((row) => `${row.start_time} · ${row.location_id}`)
                  .join("; ");
        }
      } else if (info.name.startsWith("submit_")) {
        result = result ?? `Acción ${info.label}: ${Object.values(input).join(" · ") || "sin payload"}`;
      }
      next.push({ ...turn, name: info.name, input, result });
    } catch (error) {
      next.push({
        ...turn,
        name: info.name,
        input,
        result: error instanceof Error ? error.message : compactJson(error),
      });
    }
  }
  return next;
}
