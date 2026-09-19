import { tool } from "ai";
import { z } from "zod";
import { addYmd, clinicTodayYmd } from "@/lib/time";
import { getClinicSource } from "@/lib/clinic/source";
import { CLINIC_LOCATIONS, CLINIC_SPECIALTIES } from "@/lib/clinic/options";
import type { TranscriptTurn } from "@/lib/cases/transcript";

function fields(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  );
}

function asText(output: unknown) {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "summary" in output) {
    return String((output as { summary: unknown }).summary);
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

export function clinicAgentTools(callId: string) {
  const source = getClinicSource();
  const today = clinicTodayYmd();

  return {
    agent_say: tool({
      description:
        "Marta speaks one short phone sentence. Never mention tools, JSON, or internal ids. Do not read another patient's data unless the caller has identified themselves as that patient.",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => ({ speaker: "agent" as const, text }),
    }),
    patient_say: tool({
      description: "The caller speaks one short phone sentence.",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => ({ speaker: "patient" as const, text }),
    }),
    search_directory: tool({
      description: "Look up a patient in the clinic directory by name, DNI/NIE, or phone.",
      inputSchema: z.object({
        name: z.string().optional(),
        national_id: z.string().optional(),
        phone: z.string().optional(),
      }),
      execute: async (input) => {
        const data = await source.directory(input);
        const matches = data.matches.slice(0, 5).map((match) => ({
          patient_id: match.patient_id,
          name: `${match.given_name} ${match.first_surname} ${match.second_surname}`.trim(),
          national_id: match.national_id,
          insurer: match.insurer,
        }));
        return {
          summary:
            matches.length === 0
              ? "Directorio: sin pacientes con esos datos"
              : `Directorio: ${matches.map((match) => `${match.name} (${match.national_id}, ${match.patient_id})`).join("; ")}`,
          matches,
        };
      },
    }),
    search_availability: tool({
      description: `Search bookable slots. location_id is one of ${CLINIC_LOCATIONS.map((item) => item.id).join(", ")}. specialty_id is one of ${CLINIC_SPECIALTIES.map((item) => item.id).join(", ")}.`,
      inputSchema: z.object({
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        location_id: z.string().optional(),
        specialty_id: z.string().optional(),
        patient_id: z.string().optional(),
      }),
      execute: async (input) => {
        const data = await source.availability({
          date_from: input.date_from || addYmd(today, 1),
          date_to: input.date_to || addYmd(today, 14),
          location_id: input.location_id,
          specialty_id: input.specialty_id,
          patient_id: input.patient_id,
        });
        const slots = data.slots.slice(0, 5);
        const first = slots[0];
        return {
          summary:
            slots.length === 0
              ? "Agenda: sin huecos en esa ventana"
              : `Agenda: ${data.slots.length} huecos. El más pronto es ${first?.start_time} en ${first?.location_id} con ${first?.provider_id} (${first?.appointment_type_id})`,
          slots,
        };
      },
    }),
    list_appointments: tool({
      description: "List upcoming appointments for a patient_id from the directory.",
      inputSchema: z.object({ patient_id: z.string() }),
      execute: async ({ patient_id }) => {
        const data = await source.appointments(patient_id, "upcoming");
        const rows = data.appointments.slice(0, 5);
        return {
          summary:
            rows.length === 0
              ? "Citas: no hay próximas"
              : `Citas: ${rows.map((row) => `${row.start_time} · ${row.location_id} · ${row.appointment_id}`).join("; ")}`,
          appointments: rows,
        };
      },
    }),
    submit_book: tool({
      description: "Book a slot returned by search_availability. Use exact ids and slot timestamps from the tool result.",
      inputSchema: z.object({
        patient_id: z.string(),
        provider_id: z.string(),
        location_id: z.string(),
        appointment_type_id: z.string(),
        slot: z.string(),
        policy_id: z.string().optional(),
      }),
      execute: async (input) => {
        const data = await source.submitBook({
          call_id: callId,
          policy_id: input.policy_id || "privado",
          ...input,
        });
        return { summary: `Reserva enviada para ${input.slot} en ${input.location_id}`, ...data };
      },
    }),
    submit_cancel: tool({
      description: "Cancel an existing appointment_id.",
      inputSchema: z.object({ appointment_id: z.string() }),
      execute: async ({ appointment_id }) => {
        const data = await source.submitCancel({ call_id: callId, appointment_id });
        return { summary: `Cita ${appointment_id} cancelada`, ...data };
      },
    }),
    submit_reschedule: tool({
      description: "Move an existing appointment to a new slot from search_availability.",
      inputSchema: z.object({
        appointment_id: z.string(),
        provider_id: z.string(),
        location_id: z.string(),
        slot: z.string(),
        policy_id: z.string().optional(),
      }),
      execute: async (input) => {
        const data = await source.submitReschedule({
          call_id: callId,
          policy_id: input.policy_id || "privado",
          ...input,
        });
        return { summary: `Cita movida a ${input.slot}`, ...data };
      },
    }),
    submit_register: tool({
      description: "Register a caller who is not in the directory.",
      inputSchema: z.object({
        given_name: z.string(),
        first_surname: z.string(),
        second_surname: z.string().optional(),
        national_id: z.string(),
        date_of_birth: z.string(),
        phone: z.string().optional(),
        email: z.string().optional(),
        insurer: z.string().optional(),
      }),
      execute: async (input) => {
        const data = await source.submitRegister({
          call_id: callId,
          given_name: input.given_name,
          first_surname: input.first_surname,
          second_surname: input.second_surname ?? "",
          national_id: input.national_id,
          date_of_birth: input.date_of_birth,
          phone: input.phone ?? "",
          email: input.email ?? "",
          insurer: input.insurer ?? "privado",
        });
        return { summary: `Alta de ${input.given_name} ${input.first_surname}`, ...data };
      },
    }),
    submit_no_action: tool({
      description: "Close the call without writing to the agenda.",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }) => ({ summary: `Sin cambios: ${reason}` }),
    }),
    end_call: tool({
      description: "Hang up when the conversation is finished.",
      inputSchema: z.object({}),
      execute: async () => ({ summary: "Llamada colgada" }),
    }),
  };
}

export function clinicErpTools(callId: string) {
  const { agent_say: _a, patient_say: _p, ...erp } = clinicAgentTools(callId);
  return erp;
}

export function turnFromToolCall(
  toolName: string,
  input: unknown,
  output: unknown,
  lastSpeech: string,
): TranscriptTurn | null {
  if (toolName === "end_call") return null;
  if (toolName === "agent_say" || toolName === "patient_say" || toolName === "say") {
    const spoken = input as { speaker?: string; text?: string };
    const role =
      toolName === "patient_say" || spoken.speaker === "patient" ? "patient" : "agent";
    const text = String(spoken.text ?? "").trim();
    if (!text) return null;
    return { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: "message", role, text };
  }
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "tool",
    name: toolName,
    reason: lastSpeech ? `Después de: «${lastSpeech.slice(0, 90)}»` : "Al inicio de la llamada",
    input: fields(input),
    result: asText(output),
  };
}
