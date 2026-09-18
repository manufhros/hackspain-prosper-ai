import type { ClinicProvider } from "../clinic";
import { fold } from "./rules";
import type { CallState, OfferState } from "../state/call-state";

function language(state: CallState) {
  return state.conversationLanguage;
}

export function identificationQuestion(state: CallState) {
  if (language(state) === "es") {
    return "Necesito el nombre completo del paciente y su DNI, NIE o teléfono.";
  }
  if (language(state) === "ca") {
    return "Necessito el nom complet del pacient i el DNI, NIE o telèfon.";
  }
  return "I need the patient's full name and their DNI, NIE, or phone number.";
}

export function preferenceQuestion(state: CallState) {
  if (language(state) === "es") {
    return "¿Tienes preferencia de clínica, médico, día u horario?";
  }
  if (language(state) === "ca") {
    return "Tens preferència de clínica, metge, dia o hora?";
  }
  return "Do you have a preference for clinic, doctor, day, or time?";
}

export function offerText(state: CallState, offer: OfferState) {
  const when = new Intl.DateTimeFormat(language(state) === "es" ? "es-ES" : language(state) === "ca" ? "ca-ES" : "en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(offer.slot));
  const clinic =
    offer.locationId === "centro"
      ? "Arenal Centro"
      : offer.locationId === "norte"
        ? "Arenal Norte"
        : "Arenal Sur";
  if (language(state) === "es") {
    return `Tengo cita con ${offer.providerName} en ${clinic}, el ${when}. ¿Te viene bien?`;
  }
  if (language(state) === "ca") {
    return `Tinc cita amb ${offer.providerName} a ${clinic}, el ${when}. Et va bé?`;
  }
  return `I have an appointment with ${offer.providerName} at ${clinic}, ${when}. Does that work?`;
}

export function confirmationText(state: CallState) {
  if (language(state) === "es") return "Perfecto, la cita está confirmada.";
  if (language(state) === "ca") return "Perfecte, la cita està confirmada.";
  return "Perfect, your appointment is confirmed.";
}

export function noAvailabilityText(state: CallState) {
  if (language(state) === "es") return "No tengo ninguna cita que cumpla esas preferencias.";
  if (language(state) === "ca") return "No tinc cap cita que compleixi aquestes preferències.";
  return "I don't have an appointment that matches those preferences.";
}

export function resolveRequestedProvider(
  state: CallState,
  providers: ClinicProvider[],
): ClinicProvider | undefined {
  const requested = state.constraints.providerName;
  if (!requested) return undefined;
  const wanted = fold(requested)
    .replace(/\b(dr|dra|doctor|doctora|d)\b/g, "")
    .replace(/[.,]/g, "")
    .trim();
  const candidates = providers.filter((provider) => {
    if (state.constraints.specialtyId && provider.specialty_id !== state.constraints.specialtyId) {
      return false;
    }
    const candidate = fold(provider.name)
      .replace(/\b(dr|dra|doctor|doctora|d)\b/g, "")
      .replace(/[.,]/g, "")
      .trim();
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
