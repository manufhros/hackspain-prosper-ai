import {
  listAppointments,
  listProviders,
  searchAvailability,
  searchDirectory,
  submit,
} from "../clinic";
import {
  applyTurnExtraction,
  extractTurn,
  type TurnExtraction,
} from "../extract/turn";
import {
  confirmationText,
  identificationQuestion,
  noAvailabilityText,
  offerText,
  preferenceQuestion,
  resolveRequestedProvider,
} from "../playbook/booking";
import { isEmergency } from "../playbook/rules";
import { createCallState, publicState, type CallState } from "../state/call-state";
import {
  availabilityQuery,
  buildBookPayload,
  chooseOffer,
  recordSubmission,
} from "../validators/booking";
import {
  buildCancelPayload,
  buildRegisterPayload,
  buildReschedulePayload,
} from "../validators/submissions";

export type ToolTrace = {
  name: string;
  input: unknown;
  output: unknown;
  ms?: number;
};

export type TurnEngineOptions = {
  drySubmit?: boolean;
  referenceTime?: string;
  extractor?: (text: string, state: CallState) => Promise<TurnExtraction>;
  onToolStart?: (name: string, input: unknown) => void;
  onTool?: (trace: ToolTrace) => void;
};

export type TurnResult = {
  text: string;
  context: string;
  tools: ToolTrace[];
  state: ReturnType<typeof publicState>;
};

export class TurnEngine {
  readonly state: CallState;

  constructor(
    callId: string,
    fromNumber: string | null,
    private readonly options: TurnEngineOptions = {},
  ) {
    this.state = createCallState(callId, fromNumber, options.referenceTime);
  }

  private async traced<T>(
    tools: ToolTrace[],
    name: string,
    input: unknown,
    run: () => Promise<T>,
  ) {
    this.options.onToolStart?.(name, input);
    const started = Date.now();
    try {
      const output = await run();
      const trace = { name, input, output, ms: Date.now() - started };
      tools.push(trace);
      this.options.onTool?.(trace);
      return output;
    } catch (error) {
      const output = { error: error instanceof Error ? error.message : String(error) };
      const trace = { name, input, output, ms: Date.now() - started };
      tools.push(trace);
      this.options.onTool?.(trace);
      throw error;
    }
  }

  private result(text: string, tools: ToolTrace[]): TurnResult {
    const state = publicState(this.state);
    return {
      text,
      context: `${text}\n[Internal state; never speak IDs or JSON aloud]\n${JSON.stringify(state)}`,
      tools,
      state,
    };
  }

  private async submitAction(
    tools: ToolTrace[],
    action: "book" | "register" | "reschedule" | "cancel" | "no-action" | "escalate",
    payload: Record<string, unknown>,
    traceName: string,
  ) {
    return this.traced(tools, traceName, {}, async () => {
      const output = this.options.drySubmit
        ? { dry_run: true, action, payload }
        : await submit(action, payload);
      recordSubmission(
        this.state,
        action === "no-action"
          ? "NO_ACTION"
          : (action.toUpperCase() as "BOOK" | "REGISTER" | "RESCHEDULE" | "CANCEL" | "ESCALATE"),
        payload,
        Boolean(this.options.drySubmit),
      );
      return output;
    });
  }

  async process(userText: string): Promise<TurnResult> {
    const tools: ToolTrace[] = [];
    if (this.state.phase === "closed") {
      return this.result(
        this.state.conversationLanguage === "es"
          ? "La gestión ya está completada."
          : "That request is already complete.",
        tools,
      );
    }
    const extraction = await this.traced(tools, "extractTurn", { text: userText }, () =>
      (this.options.extractor ?? extractTurn)(userText, this.state),
    );
    const acceptance = applyTurnExtraction(this.state, userText, extraction);

    if (isEmergency(userText) || this.state.intent === "escalate") {
      const payload = { call_id: this.state.callId, reason: "medical_emergency" };
      await this.submitAction(tools, "escalate", payload, "submitEscalate");
      this.state.phase = "closed";
      return this.result(
        this.state.conversationLanguage === "es"
          ? "Esto puede ser una urgencia. Llama ahora al 112."
          : "This may be an emergency. Please call emergency services now.",
        tools,
      );
    }

    if (acceptance === "accepted" && this.state.allowProviderFallback) {
      this.state.constraints.providerId = undefined;
      this.state.constraints.providerName = undefined;
      this.state.allowProviderFallback = false;
      this.state.constraintsVersion += 1;
    }

    if (acceptance === "accepted" && this.state.offer) {
      if (this.state.intent === "reschedule") {
        const payload = buildReschedulePayload(this.state);
        await this.submitAction(tools, "reschedule", payload, "submitReschedule");
      } else {
        const payload = buildBookPayload(this.state);
        await this.submitAction(tools, "book", payload, "confirmBook");
      }
      this.state.phase = "closed";
      return this.result(confirmationText(this.state), tools);
    }

    if (acceptance === "rejected" && this.state.offer) {
      this.state.offer = undefined;
      this.state.phase = "search";
    }

    if (this.state.intent !== "book") {
      if (
        this.state.intent !== "register" &&
        this.state.intent !== "cancel" &&
        this.state.intent !== "reschedule"
      ) {
        this.state.phase = "intake";
        return this.result(
          this.state.conversationLanguage === "es"
            ? "¿En qué puedo ayudarte con tu cita?"
            : "What can I help you with regarding your appointment?",
          tools,
        );
      }
    }

    if (this.state.intent !== "register") {
      const identificationPrompt = await this.resolvePatient(tools);
      if (identificationPrompt) return this.result(identificationPrompt, tools);
    }

    if (this.state.intent === "cancel" || this.state.intent === "reschedule") {
      return this.processModification(
        tools,
        extraction.appointmentDate,
        extraction.allAppointments,
      );
    }

    if (this.state.intent === "register") {
      return this.processRegistration(tools);
    }

    if (this.state.intent !== "book") {
      this.state.phase = "intake";
      return this.result(
        this.state.conversationLanguage === "es"
          ? "¿En qué puedo ayudarte con tu cita?"
          : "What can I help you with regarding your appointment?",
        tools,
      );
    }

    if (!this.state.preferencesAsked) {
      this.state.preferencesAsked = true;
      this.state.phase = "intake";
      return this.result(preferenceQuestion(this.state), tools);
    }

    const providersResponse = await this.traced(tools, "listProviders", {}, () =>
      listProviders(),
    );
    const providers = providersResponse.providers;
    if (this.state.constraints.providerName && !this.state.constraints.providerId) {
      const provider = resolveRequestedProvider(this.state, providers);
      if (!provider) {
        this.state.providerLookupAttempts += 1;
        if (this.state.providerLookupAttempts >= 2) {
          const payload = { call_id: this.state.callId, reason: "provider_not_found" };
          await this.submitAction(tools, "no-action", payload, "submitNoAction");
          this.state.phase = "closed";
          return this.result(
            this.state.conversationLanguage === "es"
              ? "No encuentro ese médico y entiendo que no quieres otra opción."
              : "I can't find that doctor, and I understand you don't want an alternative.",
            tools,
          );
        }
        return this.result(
          this.state.conversationLanguage === "es"
            ? "¿Puedes confirmar el nombre y la especialidad del médico?"
            : "Can you confirm the doctor's name and specialty?",
          tools,
        );
      }
      this.state.constraints.providerId = provider.id;
      this.state.constraints.specialtyId ??= provider.specialty_id;
      const referenceDay = this.state.referenceTime.slice(0, 10);
      if (
        provider.leave &&
        provider.leave.start <= referenceDay &&
        provider.leave.end >= referenceDay
      ) {
        this.state.allowProviderFallback = true;
        return this.result(
          this.state.conversationLanguage === "es"
            ? "Ese médico está de baja. ¿Te viene bien otro médico de la misma especialidad en esa clínica?"
            : "That doctor is away. Would another doctor in the same specialty at that clinic work?",
          tools,
        );
      }
    }

    if (!this.state.constraints.specialtyId && !this.state.constraints.providerId) {
      return this.result(
        this.state.conversationLanguage === "es"
          ? "¿Qué especialidad necesitas?"
          : "Which specialty do you need?",
        tools,
      );
    }

    const query = availabilityQuery(this.state);
    const availability = await this.traced(tools, "searchAvailability", query, () =>
      searchAvailability(query),
    );
    this.state.lastAvailability = {
      patientId: this.state.resolvedPatientId!,
      slots: availability.slots,
      blocked: availability.blocked,
      searchedAtTurn: this.state.turn,
      constraintsVersion: this.state.constraintsVersion,
    };
    const providerLanguages = new Map(
      providers.map((provider) => [provider.id, provider.languages]),
    );
    try {
      const offer = chooseOffer(this.state, availability.slots, providerLanguages);
      this.state.offer = offer;
      this.state.phase = "offer";
      return this.result(offerText(this.state, offer), tools);
    } catch {
      this.state.phase = "search";
      if (
        this.state.constraints.providerId &&
        availability.blocked.some((item) => item.restriction === "provider_on_leave")
      ) {
        this.state.allowProviderFallback = true;
        return this.result(
          this.state.conversationLanguage === "es"
            ? "Ese médico está de baja. ¿Te viene bien otro médico de la misma especialidad en esa clínica?"
            : "That doctor is away. Would another doctor in the same specialty at that clinic work?",
          tools,
        );
      }
      if (this.state.constraints.weekday != null && this.state.constraints.providerId) {
        return this.result(
          this.state.conversationLanguage === "es"
            ? "Ese médico no está en esa clínica ese día. ¿Te sirve el primer día disponible allí?"
            : "That doctor isn't at that clinic that day. Would their earliest day there work?",
          tools,
        );
      }
      return this.result(noAvailabilityText(this.state), tools);
    }
  }

  private async resolvePatient(tools: ToolTrace[]) {
    if (this.state.resolvedPatientId) return null;
    const identity = this.state.identity;
    const identifier = identity.nationalId ?? identity.phone ?? this.state.fromNumber;
    if (!identity.name || !identifier) {
      this.state.phase = "identify";
      return identificationQuestion(this.state);
    }
    const query = identity.nationalId
      ? { name: identity.name, national_id: identity.nationalId }
      : identity.phone
        ? { name: identity.name, phone: identity.phone }
        : { name: identity.name, phone: this.state.fromNumber ?? undefined };
    const directory = await this.traced(tools, "searchDirectory", query, () =>
      searchDirectory(query),
    );
    this.state.knownPatients = directory.matches;
    if (directory.matches.length !== 1) {
      this.state.phase = "identify";
      return directory.matches.length === 0
        ? this.state.conversationLanguage === "es"
          ? "No encuentro esa ficha. ¿Puedes confirmar tu fecha de nacimiento?"
          : "I can't find that record. Can you confirm the date of birth?"
        : this.state.conversationLanguage === "es"
          ? "Hay varias fichas. ¿Puedes confirmar la fecha de nacimiento?"
          : "I found several records. Can you confirm the date of birth?";
    }
    const patient = directory.matches[0]!;
    this.state.resolvedPatientId = patient.patient_id;
    this.state.constraints.insurer ??= patient.insurer;
    return null;
  }

  private async processModification(
    tools: ToolTrace[],
    appointmentDate: string | null,
    allAppointments: boolean,
  ) {
    if (this.state.listedAppointments.length === 0) {
      const appointments = await this.traced(
        tools,
        "listAppointments",
        { patient_id: this.state.resolvedPatientId, when: "upcoming" },
        () => listAppointments(this.state.resolvedPatientId!, "upcoming"),
      );
      this.state.listedAppointments = appointments.appointments;
    }
    const appointments = this.state.listedAppointments;
    if (this.state.intent === "cancel" && allAppointments) {
      for (const appointment of appointments) {
        const payload = buildCancelPayload(this.state, appointment.appointment_id);
        await this.submitAction(tools, "cancel", payload, "submitCancel");
      }
      this.state.phase = "closed";
      return this.result("Those appointments are cancelled.", tools);
    }

    if (!this.state.targetAppointmentId) {
      const matches = appointmentDate
        ? appointments.filter((item) => item.start_time.slice(0, 10) === appointmentDate)
        : appointments.length === 1
          ? appointments
          : [];
      if (matches.length !== 1) {
        return this.result(
          this.state.conversationLanguage === "es"
            ? "¿Cuál de tus próximas citas quieres cambiar?"
            : "Which upcoming appointment would you like to change?",
          tools,
        );
      }
      this.state.targetAppointmentId = matches[0]!.appointment_id;
    }

    if (this.state.intent === "cancel") {
      const payload = buildCancelPayload(this.state, this.state.targetAppointmentId);
      await this.submitAction(tools, "cancel", payload, "submitCancel");
      this.state.phase = "closed";
      return this.result("That appointment is cancelled.", tools);
    }

    const original = appointments.find(
      (item) => item.appointment_id === this.state.targetAppointmentId,
    )!;
    const providers = (await this.traced(tools, "listProviders", {}, () => listProviders()))
      .providers;
    const originalProvider = providers.find((provider) => provider.id === original.provider_id);
    this.state.constraints.providerId ??= original.provider_id;
    this.state.constraints.locationId ??= original.location_id;
    this.state.constraints.specialtyId ??= originalProvider?.specialty_id;
    if (!this.state.preferencesAsked) {
      this.state.preferencesAsked = true;
      return this.result(
        this.state.conversationLanguage === "es"
          ? "¿Para qué nuevo día u horario quieres moverla?"
          : "Which new day or time would you like to move it to?",
        tools,
      );
    }
    const query = availabilityQuery(this.state);
    const availability = await this.traced(tools, "searchAvailability", query, () =>
      searchAvailability(query),
    );
    this.state.lastAvailability = {
      patientId: this.state.resolvedPatientId!,
      slots: availability.slots,
      blocked: availability.blocked,
      searchedAtTurn: this.state.turn,
      constraintsVersion: this.state.constraintsVersion,
    };
    const offer = chooseOffer(this.state, availability.slots);
    this.state.offer = offer;
    this.state.phase = "offer";
    return this.result(offerText(this.state, offer), tools);
  }

  private async processRegistration(tools: ToolTrace[]) {
    try {
      const payload = buildRegisterPayload(this.state);
      await this.submitAction(tools, "register", payload, "submitRegister");
      this.state.phase = "closed";
      return this.result("Your registration is complete.", tools);
    } catch (error) {
      return this.result(
        error instanceof Error && error.message.startsWith("Missing registration fields:")
          ? `I still need: ${error.message
              .replace("Missing registration fields: ", "")
              .replaceAll("_", " ")}.`
          : "I need you to repeat the DNI or NIE, including its check letter.",
        tools,
      );
    }
  }
}
