import { z } from "zod";
import {
  DomainError,
  patientRegistration,
  reasonSchema,
  requestSchema,
  type Action,
  type ClinicDataSource,
  type ToolDefinition,
  type ToolResult,
} from "../../contracts/src/index.js";
import { Session } from "../../domain/src/session.js";
const str = z.string().min(1).max(200);
const language=z.enum(["en","es","ca"]).default("en");
const taskArgs = z.object({ task_id: str }).strict();
const earliestConstraints = requestSchema.innerType().omit({ date_from: true, date_to: true });
const specs = {
  search_earliest: {
    description: "Find the soonest appointment starting tomorrow. ALWAYS use this for soonest/earliest/as soon as possible: the server calculates the current dates. Preserve all caller constraints. Returns real slots; never books without a proposal and explicit confirmation.",
    schema: taskArgs.extend({ request: earliestConstraints }).strict(),
  },
  create_task: {
    description:
      "Start a separate patient operation. Returns task_id. Reuse it for corrections.",
    schema: z.object({}).strict(),
  },
  clinic_catalog: {
    description:
      "Read clinic facts, specialties, plans and rules. Never invent them.",
    schema: z.object({}).strict(),
  },
  verify_patient: {
    description:
      "Verify one patient using two caller-supplied exact identifiers. Do not use caller ID as proof. Ambiguous matches must be clarified.",
    schema: taskArgs
      .extend({
        national_id: str.optional(),
        date_of_birth: str.optional(),
        phone: str.optional(),
      })
      .strict(),
  },
  set_request: {
    description:
      "Replace the booking preferences, preserving all still-applicable constraints. Invalidates old slots and confirmation. Dates are ISO dates resolved against the supplied call time.",
    schema: taskArgs.extend({ request: requestSchema }).strict(),
  },
  find_slots: {
    description:
      "Look up real availability for the current patient and request.",
    schema: taskArgs,
  },
  more_slots: {
    description: "Read another page of previously found availability without querying again. Use next_offset from the previous page and the current revision. Slot indices are absolute; preserve caller constraints.",
    schema: taskArgs.extend({ offset: z.number().int().min(0), revision: z.number().int().min(0) }).strict(),
  },
  appointments: {
    description: "Find this verified patient’s upcoming appointments.",
    schema: taskArgs,
  },
  propose_booking: {
    description:
      "Propose one returned slot. Set language to the caller language (en/es/ca). Call this BEFORE asking for confirmation. Read the returned summary verbatim so confirmation is bound to what was presented.",
    schema: taskArgs
      .extend({
        language,
        slot_index: z.number().int().min(0),
        policy_id: str,
        appointment_id: str.optional(),
      })
      .strict(),
  },
  propose_cancellation: {
    description:
      "Propose cancellation of one upcoming appointment belonging to the verified patient. Set language to the caller language (en/es/ca).",
    schema: taskArgs.extend({ appointment_id: str, language }).strict(),
  },
  propose_registration: {
    description:
      "Propose registration only for a person not already on file; no appointment is booked. Set language to the caller language (en/es/ca).",
    schema: taskArgs.extend({ patient: patientRegistration, language }).strict(),
  },
  conclude: {
    description:
      "Record a supported refusal or escalation, never to hide a technical failure. Use published clinic rules and red flags. For no_availability query availability first.",
    schema: taskArgs
      .extend({
        action: z.enum(["NO_ACTION", "ESCALATE"]),
        reason: reasonSchema,
      })
      .strict(),
  },
  present_proposal: {
    description: "Read the EXISTING proposal and ask for confirmation again, without creating or changing it. Use when the caller asks to repeat or presentation was interrupted. Then wait for their answer.",
    schema: taskArgs.extend({ language }).strict(),
  },
  confirm_proposal: {
    description:
      "Confirm the exact proposal only after the caller explicitly agrees in a new turn. Does not submit it yet.",
    schema: taskArgs.extend({ proposal_id: str }).strict(),
  },
} as const;
export const toolDefinitions: ToolDefinition[] = Object.entries(specs).map(
  ([name, s]) => ({
    name,
    description: s.description,
    parameters: jsonSchema(s.schema),
  }),
);
// Keep provider-independent validation authoritative; provider JSON schemas are hints.
function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) return jsonSchema(schema.innerType());
  if (schema instanceof z.ZodDefault) return jsonSchema(schema._def.innerType);
  if (schema instanceof z.ZodOptional) return jsonSchema(schema.unwrap());
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "integer" };
  if (schema instanceof z.ZodEnum)
    return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodArray)
    return { type: "array", items: jsonSchema(schema.element) };
  if (schema instanceof z.ZodObject) {
    const entries = Object.entries(schema.shape) as [string, z.ZodTypeAny][];
    return {
      type: "object",
      properties: Object.fromEntries(
        entries.map(([k, v]) => [k, jsonSchema(v)]),
      ),
      required: entries.filter(([, v]) => !v.isOptional()).map(([k]) => k),
      additionalProperties: false,
    };
  }
  throw new Error("Unsupported tool schema");
}
export class ToolGateway {
  private slotPage(t: ReturnType<Session["getTask"]>, offset: number) {
    return {
      revision: t.revision,
      slots: t.slots.slice(offset, offset + 5).map((slot, i) => ({ ...slot, index: offset + i })),
      total: t.slots.length,
      next_offset: offset + 5 < t.slots.length ? offset + 5 : null,
      blocked: t.blocked,
    };
  }

  private availabilityFailures = new Map<string, number>();
  constructor(
    readonly session: Session,
    readonly clinic: ClinicDataSource,
  ) {}
  async execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    try {
      this.session.assertOpen();
      signal?.throwIfAborted();
      const spec = specs[name as keyof typeof specs];
      if (!spec) throw new DomainError("unknown_tool");
      const parsed = spec.schema.parse(args) as Record<string, unknown>;
      this.session.emit("tool.started", { name });
      const data = await this.run(name, parsed, signal);
      signal?.throwIfAborted();
      this.session.emit("tool.completed", { name });
      return { ok: true, data };
    } catch (error) {
      const code =
        error instanceof DomainError
          ? error.code
          : error instanceof z.ZodError
            ? "invalid_arguments"
            : signal?.aborted
              ? "cancelled"
              : "dependency_failed";
      this.session.emit("tool.failed", { name, code });
      return { ok: false, error: code, data: {
        today: this.session.snapshot().today,
        earliestSearch: this.session.earliestWindow(),
        task_ids: [...this.session.tasks.keys()],
        recovery: code === "explicit_confirmation_required" ? "Ask whether the caller confirms the exact proposal. Do not tell them specific words to say."
          : code === "proposal_must_be_presented_first" ? "Present the existing proposal and wait for a NEW user answer. Do not recreate it."
          : code === "window_must_be_1_to_14_days" || code === "future_date_required" ? "For earliest requests use search_earliest. Otherwise use the caller's future dates, at most 14 inclusive days. Do not ask the caller to fix system dates."
          : code === "availability_retry_exhausted" ? "Stop retrying unchanged availability. Explain briefly that booking could not be completed. Never invent no availability, an escalation or a callback."
          : "Correct the tool arguments using the authoritative state/catalog. Do not repeat the same invalid call or read internal error codes to the caller.",
      } };
    }
  }
  private async run(
    name: string,
    a: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (name === "create_task") return { task_id: this.session.newTask().id };
    if (name === "clinic_catalog") return this.clinic.catalog(signal);
    const t = this.session.getTask(a.task_id as string);
    const revision = t.revision;
    const unchanged = () => {
      signal?.throwIfAborted();
      this.session.assertOpen();
      if (t.revision !== revision) throw new DomainError("stale_result");
    };
    if (name === "verify_patient") {
      const query = {
        national_id: a.national_id as string | undefined,
        date_of_birth: a.date_of_birth as string | undefined,
        phone: a.phone as string | undefined,
      };
      if (Object.values(query).filter(Boolean).length < 2)
        throw new DomainError("two_identifiers_required");
      this.session.invalidate(t);
      t.patient = undefined;
      t.request = undefined;
      const identityRevision = t.revision;
      const matches = await this.clinic.patients(query, signal);
      signal?.throwIfAborted();
      this.session.assertOpen();
      if (t.revision !== identityRevision)
        throw new DomainError("stale_result");
      if (matches.length !== 1)
        return {
          status: matches.length ? "ambiguous" : "not_found",
          count: matches.length,
        };
      const p = matches[0]!;
      this.session.identify(t, p);
      return {
        status: "verified",
        patient_id: p.patient_id,
        name: [p.given_name, p.first_surname, p.second_surname].join(" "),
        insurer: p.insurer,
        has_visited_before: p.has_visited_before,
        note: p.note,
      };
    }
    if (name === "set_request" || name === "search_earliest") {
      const raw = a.request as Record<string, unknown>;
      const request: Record<string, unknown> = { ...raw, ...(name === "search_earliest" ? this.session.earliestWindow() : {}) };
      const catalog = await this.clinic.catalog(signal) as { specialties?: { id: string; name: string }[] };
      unchanged();
      if (request.specialty_id && catalog.specialties) {
        const value = String(request.specialty_id).toLowerCase();
        const alias = ({ orthopedics: "orthopaedics", pediatrics: "paediatrics", gynecology: "gynaecology", gp: "general_practice" } as Record<string, string>)[value] ?? value;
        const specialty = catalog.specialties.find(x => x.id === alias || x.name.toLowerCase() === value);
        if (!specialty) throw new DomainError("unknown_specialty_use_catalog");
        request.specialty_id = specialty.id;
      }
      this.session.request(t, request);
      if (name === "search_earliest") return this.run("find_slots", { task_id: t.id }, signal);
      return { task_id: t.id, revision: t.revision, request: t.request };
    }
    if (name === "propose_registration") {
      const patient = patientRegistration.parse(a.patient);
      const existing = await this.clinic.patients(
        { national_id: patient.national_id },
        signal,
      );
      unchanged();
      if (existing.length) throw new DomainError("patient_already_exists");
      this.session.invalidate(t);
      return this.session.propose(
        t,
        { action: "REGISTER", new_patient: patient },
        a.language==='es'?`Alta de ${patient.given_name} ${patient.first_surname} ${patient.second_surname}; documento ${patient.national_id}, nacimiento ${patient.date_of_birth}, teléfono ${patient.phone}, email ${patient.email}, seguro ${patient.insurer}.`:a.language==='ca'?`Alta de ${patient.given_name} ${patient.first_surname} ${patient.second_surname}; document ${patient.national_id}, naixement ${patient.date_of_birth}, telèfon ${patient.phone}, correu ${patient.email}, assegurança ${patient.insurer}.`:`Register ${patient.given_name} ${patient.first_surname} ${patient.second_surname}; ID ${patient.national_id}, date of birth ${patient.date_of_birth}, phone ${patient.phone}, email ${patient.email}, insurance ${patient.insurer}.`,
      );
    }
    if (name === "conclude") {
      const reason = reasonSchema.parse(a.reason);
      if (
        reason === "no_availability" &&
        (!t.request || t.slots.length || !t.blocked.includes("no_availability"))
      )
        throw new DomainError("availability_evidence_required");
      if (a.action === "ESCALATE" && reason !== "medical_emergency")
        throw new DomainError("unsupported_escalation");
      if (a.action === "NO_ACTION" && reason === "medical_emergency")
        throw new DomainError("escalation_required");
      const restrictions = [
        "not_eligible_age",
        "referral_required",
        "provider_not_in_network",
        "specialty_not_covered",
        "location_not_covered",
        "insurer_referral_required",
        "allowance_exhausted",
        "provider_on_leave",
        "location_hours",
        "type_not_offered",
        "patient_history",
      ];
      if (restrictions.includes(reason) && !t.blocked.includes(reason))
        throw new DomainError("restriction_evidence_required");
      const p = this.session.propose(
        t,
        { action: a.action, reason },
        `${a.action}: ${reason}`,
      );
      p.confirmed = true;
      return p;
    }
    if (name === "present_proposal") {
      if (!t.proposal) throw new DomainError("proposal_required");
      return t.proposal;
    }
    if (name === "confirm_proposal")
      return this.session.confirm(t, a.proposal_id as string);
    if (!t.patient) throw new DomainError("patient_not_verified");
    if (name === "appointments")
      return this.clinic.appointments(t.patient.patient_id, signal);
    if (name === "more_slots") {
      if (a.revision !== t.revision) throw new DomainError("stale_result");
      return this.slotPage(t, a.offset as number);
    }
    if (name === "find_slots") {
      if (!t.request) throw new DomainError("request_required");
      const lookup = { ...t.request, patient_id: t.patient.patient_id };
      const key = JSON.stringify(lookup);
      if ((this.availabilityFailures.get(key) ?? 0) >= 2) throw new DomainError("availability_retry_exhausted");
      let result;
      try {
        result = await this.clinic.availability(lookup, signal);
        this.availabilityFailures.delete(key);
      } catch (error) {
        if (!signal?.aborted) this.availabilityFailures.set(key, (this.availabilityFailures.get(key) ?? 0) + 1);
        throw error;
      }
      unchanged();
      this.session.acceptSlots(
        t,
        revision,
        result.slots,
        result.blocked.map((x) => x.restriction),
      );
      if (!t.slots.length && !t.blocked.length) t.blocked = ["no_availability"];
      return this.slotPage(t, 0);
    }
    if (name === "propose_booking") {
      const slot = t.slots[a.slot_index as number];
      if (!slot) throw new DomainError("unknown_slot");
      const policy = a.policy_id as string;
      if (!slot.payable_with.includes(policy))
        throw new DomainError("policy_not_accepted");
      const knownPolicies = [t.patient.insurer, ...(t.request?.insurer ?? [])];
      if (!knownPolicies.includes(policy))
        throw new DomainError("policy_not_declared");
      let action: Action = {
        action: "BOOK",
        patient_id: t.patient.patient_id,
        provider_id: slot.provider_id,
        location_id: slot.location_id,
        appointment_type_id: slot.appointment_type_id,
        slot: slot.start_time,
        policy_id: policy,
      };
      if (a.appointment_id) {
        const existing = await this.clinic.appointments(
          t.patient.patient_id,
          signal,
        );
        unchanged();
        if (
          !existing.some(
            (x) =>
              x.appointment_id === a.appointment_id &&
              Date.parse(x.start_time) > this.session.startedAt.getTime(),
          )
        )
          throw new DomainError("unknown_upcoming_appointment");
        action = {
          action: "RESCHEDULE",
          appointment_id: a.appointment_id as string,
          provider_id: slot.provider_id,
          location_id: slot.location_id,
          slot: slot.start_time,
          policy_id: policy,
        };
      }
      return this.session.propose(
        t,
        action,
        `${slot.provider_name}, ${slot.location_id}, ${new Intl.DateTimeFormat(a.language as string,{timeZone:'Europe/Madrid',dateStyle:'long',timeStyle:'short',hour12:false}).format(new Date(slot.start_time))}, ${a.language==='es'?'seguro':a.language==='ca'?'assegurança':'insurance'} ${policy}.`,
      );
    }
    if (name === "propose_cancellation") {
      const appointments = await this.clinic.appointments(
        t.patient.patient_id,
        signal,
      );
      unchanged();
      const appointment = appointments.find(
        (x) =>
          x.appointment_id === a.appointment_id &&
          Date.parse(x.start_time) > this.session.startedAt.getTime(),
      );
      if (!appointment) throw new DomainError("unknown_upcoming_appointment");
      return this.session.propose(
        t,
        { action: "CANCEL", appointment_id: appointment.appointment_id },
        `${a.language==='es'?'Cancelar la cita':a.language==='ca'?"Cancel·lar la cita":'Cancel appointment'} ${appointment.appointment_id}: ${new Intl.DateTimeFormat(a.language as string,{timeZone:'Europe/Madrid',dateStyle:'long',timeStyle:'short',hour12:false}).format(new Date(appointment.start_time))}.`,
      );
    }
    throw new DomainError("unknown_tool");
  }
}
