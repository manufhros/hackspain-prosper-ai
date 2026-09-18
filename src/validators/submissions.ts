import type { CallState } from "../state/call-state";

export function normalizeNationalId(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function validSpanishNationalId(value: string) {
  const normalized = normalizeNationalId(value);
  const match = normalized.match(/^([XYZ]?)(\d{7,8})([A-Z])$/);
  if (!match) return false;
  const prefix = match[1] === "X" ? "0" : match[1] === "Y" ? "1" : match[1] === "Z" ? "2" : "";
  const number = Number(`${prefix}${match[2]}`);
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  return letters[number % 23] === match[3];
}

export function buildRegisterPayload(state: CallState) {
  const required = [
    "given_name",
    "first_surname",
    "second_surname",
    "national_id",
    "date_of_birth",
    "phone",
    "email",
    "insurer",
  ] as const;
  const missing = required.filter((key) => !state.registration[key]);
  if (missing.length) throw new Error(`Missing registration fields: ${missing.join(", ")}`);
  if (!validSpanishNationalId(state.registration.national_id!)) {
    throw new Error("Invalid DNI/NIE check letter");
  }
  return {
    call_id: state.callId,
    given_name: state.registration.given_name!,
    first_surname: state.registration.first_surname!,
    second_surname: state.registration.second_surname!,
    national_id: normalizeNationalId(state.registration.national_id!),
    date_of_birth: state.registration.date_of_birth!,
    phone: state.registration.phone!,
    email: state.registration.email!.replace(/\s/g, "").toLowerCase(),
    insurer: state.registration.insurer!,
  };
}

export function buildCancelPayload(state: CallState, appointmentId: string) {
  if (!state.listedAppointments.some((appointment) => appointment.appointment_id === appointmentId)) {
    throw new Error("appointment_id must come from the upcoming appointments lookup");
  }
  return { call_id: state.callId, appointment_id: appointmentId };
}

export function buildReschedulePayload(state: CallState) {
  if (!state.targetAppointmentId) throw new Error("No existing appointment selected");
  if (!state.listedAppointments.some((item) => item.appointment_id === state.targetAppointmentId)) {
    throw new Error("appointment_id must come from upcoming appointments");
  }
  const offer = state.offer;
  if (!offer) throw new Error("No replacement slot offered");
  const source = state.lastAvailability?.slots.find(
    (slot) =>
      slot.provider_id === offer.providerId &&
      slot.location_id === offer.locationId &&
      slot.start_time === offer.slot &&
      slot.payable_with.includes(offer.policyId),
  );
  if (!source) throw new Error("Replacement slot must come from availability");
  return {
    call_id: state.callId,
    appointment_id: state.targetAppointmentId,
    provider_id: source.provider_id,
    location_id: source.location_id,
    slot: source.start_time,
    policy_id: offer.policyId,
  };
}
