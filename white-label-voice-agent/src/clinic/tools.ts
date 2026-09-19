import { tool } from "ai";
import { z } from "zod";
import { PlatformClient } from "../platform/client.ts";
import type { AvailabilityQuery, DirectoryQuery, OutcomeReason } from "../platform/types.ts";
import {
  asInsurer,
  asLocation,
  asSpecialty,
  asString,
  compact,
  rankAvailability,
  resolveDateRange,
} from "./normalize.ts";

export type CallContext = {
  callId: string;
  fromNumber: string | null;
  platform: PlatformClient;
  /** Se marca en cuanto se envía una acción terminal, para no mandar dos. */
  submitted: { action: string } | null;
  onTool?: (name: string, input: unknown, output: string) => void;
};

/**
 * Descripciones portadas de `scripts/configure-agent.ts` de la rama de Lucía:
 * allí se subían a ElevenLabs, aquí son tools locales del AI SDK.
 */
export function clinicTools(ctx: CallContext) {
  const trace = async (name: string, input: unknown, run: () => Promise<unknown>) => {
    let output: string;
    try {
      output = JSON.stringify(await run());
    } catch (error) {
      output = JSON.stringify({
        error: error instanceof Error ? error.message : "tool failed",
      });
    }
    ctx.onTool?.(name, input, output);
    return output;
  };

  const markSubmitted = (action: string) => {
    ctx.submitted = { action };
  };

  return {
    search_directory: tool({
      description:
        "Look up a patient in Clínica Arenal. Use name plus DNI/NIE or phone or date of birth. An exact field that does not match excludes the patient. Returns matches with patient_id, insurer, has_visited_before, referrals, note.",
      inputSchema: z.object({
        name: z.string().optional().describe("Full or partial name as heard"),
        national_id: z.string().optional().describe("DNI or NIE as dictated"),
        phone: z.string().optional().describe("Phone digits as heard"),
        date_of_birth: z.string().optional().describe("ISO date YYYY-MM-DD"),
      }),
      execute: (input) =>
        trace("search_directory", input, () =>
          ctx.platform.directory(
            compact({
              name: asString(input.name),
              national_id: asString(input.national_id),
              phone: asString(input.phone),
              date_of_birth: asString(input.date_of_birth),
            }) as DirectoryQuery,
          ),
        ),
    }),

    search_availability: tool({
      description:
        "Search real bookable slots. Always pass patient_id when known. date_from/date_to ISO dates, span at most 14 days. Earliest appointment means the day AFTER madrid_today, never same-day. Submit appointment_type_id and slot exactly as returned. blocked[].restriction is the OutcomeReason if you must refuse.",
      inputSchema: z.object({
        date_from: z.string().optional().describe("First day inclusive YYYY-MM-DD"),
        date_to: z.string().optional().describe("Last day inclusive YYYY-MM-DD"),
        patient_id: z.string().optional().describe("From directory"),
        specialty_id: z.string().optional().describe("e.g. general_practice"),
        provider_id: z.string().optional().describe("e.g. PR01"),
        location_id: z.string().optional().describe("centro, norte or sur"),
        insurer: z.string().optional().describe("Plan id to quote against, e.g. mapfre"),
      }),
      execute: (input) =>
        trace("search_availability", input, async () => {
          const range = resolveDateRange(input.date_from, input.date_to);
          const insurer = asInsurer(input.insurer);
          const raw = await ctx.platform.availability(
            compact({
              ...range,
              provider_id: asString(input.provider_id),
              specialty_id: asSpecialty(input.specialty_id),
              location_id: asLocation(input.location_id),
              patient_id: asString(input.patient_id),
              ...(insurer ? { insurer: [insurer] } : {}),
            }) as AvailabilityQuery,
          );
          return { ...rankAvailability(raw), searched: range };
        }),
    }),

    list_appointments: tool({
      description:
        "Upcoming appointments for a patient. Only source of appointment_id for cancel/reschedule.",
      inputSchema: z.object({ patient_id: z.string().describe("From directory") }),
      execute: (input) =>
        trace("list_appointments", input, () =>
          ctx.platform.appointments(input.patient_id, "upcoming"),
        ),
    }),

    submit_book: tool({
      description:
        "Report a booking for this call. Use ids from directory and availability only. slot must include timezone offset. Never invent ids.",
      inputSchema: z.object({
        patient_id: z.string().describe("P0… from directory"),
        provider_id: z.string().describe("PR… from availability"),
        location_id: z.string().describe("centro | norte | sur"),
        appointment_type_id: z.string().describe("From availability.appointment_type.id"),
        slot: z.string().describe("start_time from the chosen slot"),
        policy_id: z.string().describe("Insurer billed, usually the plan on file"),
      }),
      execute: (input) =>
        trace("submit_book", input, async () => {
          const policy = asInsurer(input.policy_id);
          const location_id = asLocation(input.location_id);
          if (!policy || !location_id) return { error: "bad policy_id or location_id" };
          markSubmitted("BOOK");
          return ctx.platform.submitBook({
            call_id: ctx.callId,
            patient_id: input.patient_id,
            provider_id: input.provider_id,
            location_id,
            appointment_type_id: input.appointment_type_id,
            slot: input.slot,
            policy_id: policy,
          });
        }),
    }),

    submit_register: tool({
      description:
        "Caller not on file. Demographics are the answer; do not also BOOK in the new-patient problem. DNI check letter must match digits.",
      inputSchema: z.object({
        given_name: z.string(),
        first_surname: z.string(),
        second_surname: z.string(),
        national_id: z.string().describe("DNI/NIE with check letter"),
        date_of_birth: z.string().describe("YYYY-MM-DD"),
        phone: z.string(),
        email: z.string(),
        insurer: z.string().describe("plan id"),
      }),
      execute: (input) =>
        trace("submit_register", input, async () => {
          const insurer = asInsurer(input.insurer);
          if (!insurer) return { error: `unknown insurer ${input.insurer}` };
          markSubmitted("REGISTER");
          return ctx.platform.submitRegister({ call_id: ctx.callId, ...input, insurer });
        }),
    }),

    submit_no_action: tool({
      description:
        "Call ended without a write. reason must be the closed vocabulary (no_availability, referral_required, insurer_referral_required, provider_not_found, not_eligible_age, location_not_covered, out_of_scope, …). Copy the restriction id from availability.blocked when there was one.",
      inputSchema: z.object({ reason: z.string().describe("OutcomeReason") }),
      execute: (input) =>
        trace("submit_no_action", input, async () => {
          markSubmitted("NO_ACTION");
          return ctx.platform.submitNoAction({
            call_id: ctx.callId,
            reason: input.reason as OutcomeReason,
          });
        }),
    }),

    submit_escalate: tool({
      description: "Hand to a human. Use medical_emergency for published red flags.",
      inputSchema: z.object({
        reason: z.string().describe("OutcomeReason, usually medical_emergency"),
      }),
      execute: (input) =>
        trace("submit_escalate", input, async () => {
          markSubmitted("ESCALATE");
          return ctx.platform.submitEscalate({
            call_id: ctx.callId,
            reason: input.reason as OutcomeReason,
          });
        }),
    }),

    submit_cancel: tool({
      description: "Cancel one upcoming appointment. Two cancels = two calls.",
      inputSchema: z.object({ appointment_id: z.string().describe("From list_appointments") }),
      execute: (input) =>
        trace("submit_cancel", input, async () => {
          markSubmitted("CANCEL");
          return ctx.platform.submitCancel({
            call_id: ctx.callId,
            appointment_id: input.appointment_id,
          });
        }),
    }),

    submit_reschedule: tool({
      description:
        "Move an existing upcoming appointment to a new slot from search_availability.",
      inputSchema: z.object({
        appointment_id: z.string().describe("From list_appointments"),
        provider_id: z.string().describe("PR id from availability"),
        location_id: z.string().describe("centro, norte or sur"),
        slot: z.string().describe("start_time with timezone offset"),
        policy_id: z.string().describe("Insurer billed"),
      }),
      execute: (input) =>
        trace("submit_reschedule", input, async () => {
          const policy = asInsurer(input.policy_id);
          const location_id = asLocation(input.location_id);
          if (!policy || !location_id) return { error: "bad policy_id or location_id" };
          markSubmitted("RESCHEDULE");
          return ctx.platform.submitReschedule({
            call_id: ctx.callId,
            appointment_id: input.appointment_id,
            provider_id: input.provider_id,
            location_id,
            slot: input.slot,
            policy_id: policy,
          });
        }),
    }),
  };
}
