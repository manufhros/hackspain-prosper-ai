import { tool } from "ai";
import { z } from "zod";
import { addYmd, clinicTodayYmd, prosper } from "./prosper";

const LOCATIONS = "centro, norte, sur";
const SPECIALTIES = "general_practice, paediatrics, dermatology, gynaecology, orthopaedics, physiotherapy";

function fields(input: unknown) {
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

export type SimTurn =
  | { id: string; kind: "message"; role: "agent" | "patient"; text: string }
  | { id: string; kind: "tool"; name: string; input?: Record<string, string>; result?: string };

function turnId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function clinicAgentTools(callId: string) {
  const source = await prosper();
  const today = clinicTodayYmd();

  return {
    agent_say: tool({
      description: "Marta speaks one short phone sentence. Never mention tools, JSON, or internal ids.",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => ({ speaker: "agent" as const, text }),
    }),
    patient_say: tool({
      description: "The caller speaks one short phone sentence.",
      inputSchema: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => ({ speaker: "patient" as const, text }),
    }),
    search_directory: tool({
      description: "Look up a patient by name, DNI/NIE, or phone.",
      inputSchema: z.object({
        name: z.string().optional(),
        national_id: z.string().optional(),
        phone: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const data = await source.directory(input);
          const matches = data.matches.slice(0, 5).map((match) => ({
            patient_id: match.patient_id,
            name: `${match.given_name} ${match.first_surname} ${match.second_surname}`.trim(),
            national_id: match.national_id,
            insurer: match.insurer,
          }));
          return {
            summary: matches.length === 0
              ? "Directorio: sin pacientes con esos datos"
              : `Directorio: ${matches.map((match) => `${match.name} (${match.national_id}, ${match.patient_id})`).join("; ")}`,
            matches,
          };
        } catch (error) {
          return { summary: `Directorio no disponible: ${error instanceof Error ? error.message : "error"}`, matches: [] };
        }
      },
    }),
    search_availability: tool({
      description: `Search bookable slots. location_id is one of ${LOCATIONS}. specialty_id is one of ${SPECIALTIES}.`,
      inputSchema: z.object({
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        location_id: z.string().optional(),
        specialty_id: z.string().optional(),
        patient_id: z.string().optional(),
      }),
      execute: async (input) => {
        try {
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
            summary: slots.length === 0
              ? "Agenda: sin huecos en esa ventana"
              : `Agenda: ${data.slots.length} huecos. El más pronto es ${first?.start_time} en ${first?.location_id} con ${first?.provider_id} (${first?.appointment_type_id})`,
            slots,
          };
        } catch (error) {
          return { summary: `Agenda no disponible: ${error instanceof Error ? error.message : "error"}`, slots: [] };
        }
      },
    }),
    list_appointments: tool({
      description: "List upcoming appointments for a patient_id from the directory.",
      inputSchema: z.object({ patient_id: z.string() }),
      execute: async ({ patient_id }) => {
        try {
          const data = await source.appointments(patient_id);
          const rows = data.appointments.slice(0, 5);
          return {
            summary: rows.length === 0
              ? "Citas: no hay próximas"
              : `Citas: ${rows.map((row) => `${row.start_time} · ${row.location_id} · ${row.appointment_id}`).join("; ")}`,
            appointments: rows,
          };
        } catch (error) {
          return { summary: `Citas no disponibles: ${error instanceof Error ? error.message : "error"}`, appointments: [] };
        }
      },
    }),
    submit_book: tool({
      description: "Book a slot returned by search_availability.",
      inputSchema: z.object({
        patient_id: z.string(),
        provider_id: z.string(),
        location_id: z.string(),
        appointment_type_id: z.string(),
        slot: z.string(),
        policy_id: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const data = await source.submitBook({
            call_id: callId,
            policy_id: input.policy_id || "privado",
            ...input,
          });
          return { summary: `Reserva enviada para ${input.slot} en ${input.location_id}`, ...data };
        } catch (error) {
          return { summary: `Reserva fallida: ${error instanceof Error ? error.message : "error"}` };
        }
      },
    }),
    submit_cancel: tool({
      description: "Cancel an existing appointment_id.",
      inputSchema: z.object({ appointment_id: z.string() }),
      execute: async ({ appointment_id }) => {
        try {
          const data = await source.submitCancel({ call_id: callId, appointment_id });
          return { summary: `Cita ${appointment_id} cancelada`, ...data };
        } catch (error) {
          return { summary: `Cancelación fallida: ${error instanceof Error ? error.message : "error"}` };
        }
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
        try {
          const data = await source.submitReschedule({
            call_id: callId,
            policy_id: input.policy_id || "privado",
            ...input,
          });
          return { summary: `Cita movida a ${input.slot}`, ...data };
        } catch (error) {
          return { summary: `Cambio fallido: ${error instanceof Error ? error.message : "error"}` };
        }
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
        try {
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
        } catch (error) {
          return { summary: `Alta fallida: ${error instanceof Error ? error.message : "error"}` };
        }
      },
    }),
    submit_no_action: tool({
      description: "Close the call without writing to the agenda.",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }) => ({ summary: `Sin cambios: ${reason}` }),
    }),
    submit_escalate: tool({
      description: "Hand the call to a human.",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }) => {
        try {
          await source.submitEscalate({ call_id: callId, reason });
        } catch {
          /* the desk still records the intent */
        }
        return { summary: `Escalado: ${reason}` };
      },
    }),
    end_call: tool({
      description: "Hang up when the conversation is finished.",
      inputSchema: z.object({}),
      execute: async () => ({ summary: "Llamada colgada" }),
    }),
  };
}

export function turnFromToolCall(
  toolName: string,
  input: unknown,
  output: unknown,
): SimTurn | null {
  if (toolName === "end_call") return null;
  if (toolName === "agent_say" || toolName === "patient_say") {
    const spoken = input as { text?: string };
    const text = String(spoken.text ?? "").trim();
    if (!text) return null;
    return {
      id: turnId(),
      kind: "message",
      role: toolName === "patient_say" ? "patient" : "agent",
      text,
    };
  }
  return {
    id: turnId(),
    kind: "tool",
    name: toolName,
    input: fields(input),
    result: asText(output),
  };
}
