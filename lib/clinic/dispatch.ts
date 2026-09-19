import type { ClinicSource, OutcomeReason } from "./types";

export async function dispatchSubmit(
  source: ClinicSource,
  body: Record<string, unknown>,
) {
  const action = String(body.action ?? "");
  const call_id = typeof body.call_id === "string" && body.call_id.trim() ? body.call_id : "desk";

  switch (action) {
    case "BOOK":
      return source.submitBook({
        call_id,
        patient_id: String(body.patient_id ?? ""),
        provider_id: String(body.provider_id ?? ""),
        location_id: String(body.location_id ?? ""),
        appointment_type_id: String(body.appointment_type_id ?? ""),
        slot: String(body.slot ?? ""),
        policy_id: String(body.policy_id ?? ""),
      });
    case "REGISTER":
      return source.submitRegister({
        call_id,
        given_name: String(body.given_name ?? ""),
        first_surname: String(body.first_surname ?? ""),
        second_surname: String(body.second_surname ?? ""),
        national_id: String(body.national_id ?? ""),
        date_of_birth: String(body.date_of_birth ?? ""),
        phone: String(body.phone ?? ""),
        email: String(body.email ?? ""),
        insurer: String(body.insurer ?? ""),
      });
    case "RESCHEDULE":
      return source.submitReschedule({
        call_id,
        appointment_id: String(body.appointment_id ?? ""),
        provider_id: String(body.provider_id ?? ""),
        location_id: String(body.location_id ?? ""),
        slot: String(body.slot ?? ""),
        policy_id: String(body.policy_id ?? ""),
      });
    case "CANCEL":
      return source.submitCancel({
        call_id,
        appointment_id: String(body.appointment_id ?? ""),
      });
    case "NO_ACTION":
      return source.submitNoAction({
        call_id,
        reason: String(body.reason ?? "out_of_scope") as OutcomeReason,
      });
    case "ESCALATE":
      return source.submitEscalate({
        call_id,
        reason: String(body.reason ?? "medical_emergency") as OutcomeReason,
      });
    default:
      throw new Error(`Unknown action ${action}`);
  }
}
