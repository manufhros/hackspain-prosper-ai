import { earliestBookableDay, selectEarliestSlot, windowEnd } from "../playbook/rules";
import type {
  AvailabilitySlot,
  CallState,
  OfferState,
  SubmissionRecord,
} from "../state/call-state";

export function requireKnownPatient(state: CallState, patientId: string) {
  if (!state.knownPatients.some((patient) => patient.patient_id === patientId)) {
    throw new Error("patient_id must come from searchDirectory in this call");
  }
}

export function availabilityQuery(state: CallState) {
  const patientId = state.resolvedPatientId;
  if (!patientId) throw new Error("Resolve a patient before searching availability");
  requireKnownPatient(state, patientId);
  if (!state.constraints.specialtyId && !state.constraints.providerId) {
    throw new Error("A specialty or provider is required before searching availability");
  }
  const minimum = earliestBookableDay(state.referenceTime);
  const requestedFrom = state.constraints.dateFrom ?? minimum;
  const dateFrom = requestedFrom < minimum ? minimum : requestedFrom;
  const requestedTo = state.constraints.dateTo;
  const dateTo = requestedTo && requestedTo >= dateFrom ? requestedTo : windowEnd(dateFrom);
  return {
    date_from: dateFrom,
    date_to: dateTo > windowEnd(dateFrom) ? windowEnd(dateFrom) : dateTo,
    patient_id: patientId,
    specialty_id: state.constraints.specialtyId,
    provider_id: state.constraints.providerId,
    location_id: state.constraints.locationId,
    insurer: state.constraints.insurer,
  };
}

export function chooseOffer(
  state: CallState,
  slots: AvailabilitySlot[],
  providerLanguages: Map<string, string[]> = new Map(),
): OfferState {
  const patientId = state.resolvedPatientId;
  if (!patientId) throw new Error("Cannot offer without a resolved patient");
  const eligibleSlots = slots.filter(
    (slot) =>
      !state.rejectedSlots.includes(slot.start_time) &&
      (!state.replacementNotBefore ||
        new Date(slot.start_time).getTime() > new Date(state.replacementNotBefore).getTime()),
  );
  const slot = selectEarliestSlot(eligibleSlots, state.constraints, providerLanguages);
  if (!slot) throw new Error("No slot matches all caller constraints");
  const policyId = state.activePolicy ?? state.constraints.insurer ?? state.primaryPolicy;
  if (!policyId || !slot.payable_with.includes(policyId)) {
    throw new Error("Selected slot is not payable with the caller's active policy");
  }
  return {
    patientId,
    providerId: slot.provider_id,
    providerName: slot.provider_name,
    locationId: slot.location_id,
    appointmentTypeId: slot.appointment_type_id,
    slot: slot.start_time,
    policyId,
    offeredAtTurn: state.turn,
    constraintsVersion: state.constraintsVersion,
  };
}

export function buildBookPayload(state: CallState) {
  const offer = state.offer;
  if (!offer) throw new Error("No appointment has been selected and offered");
  if (offer.constraintsVersion !== state.constraintsVersion) {
    throw new Error("The offer is stale because caller constraints changed");
  }
  if (state.lastAvailability?.constraintsVersion !== state.constraintsVersion) {
    throw new Error("Availability is stale because caller constraints changed");
  }
  if (state.turn <= offer.offeredAtTurn) {
    throw new Error("Booking requires acceptance in a later caller turn");
  }
  const source = state.lastAvailability?.slots.find(
    (slot) =>
      slot.provider_id === offer.providerId &&
      slot.location_id === offer.locationId &&
      slot.appointment_type_id === offer.appointmentTypeId &&
      slot.start_time === offer.slot &&
      slot.payable_with.includes(offer.policyId),
  );
  if (!source) throw new Error("Offered slot is not in the latest availability response");
  return {
    call_id: state.callId,
    patient_id: offer.patientId,
    provider_id: source.provider_id,
    location_id: source.location_id,
    appointment_type_id: source.appointment_type_id,
    slot: source.start_time,
    policy_id: offer.policyId,
  };
}

export function recordSubmission(
  state: CallState,
  action: SubmissionRecord["action"],
  payload: Record<string, unknown>,
  dryRun: boolean,
) {
  const fingerprint = JSON.stringify({ action, payload });
  if (
    state.submissions.some(
      (submission) =>
        JSON.stringify({ action: submission.action, payload: submission.payload }) === fingerprint,
    )
  ) {
    throw new Error(`Duplicate ${action} submission`);
  }
  state.submissions.push({ action, payload, turn: state.turn, dryRun });
  state.phase = "submit";
}
