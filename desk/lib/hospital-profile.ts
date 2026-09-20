import { organisationOf } from "./orgs";

export const HOSPITAL_FAQ = [
  {
    id: "faq-centros",
    question: "¿Qué centros tenéis?",
    answer: "Tres sedes: Centro y Norte en Madrid, y Sur en Getafe. Si no dicen cuál, el agente pregunta antes de buscar agenda.",
  },
  {
    id: "faq-sabado",
    question: "¿Qué centro abre los sábados?",
    answer: "Centro abre los sábados. Norte y Sur no. Ningún centro abre los domingos.",
  },
  {
    id: "faq-gestiones",
    question: "¿Qué gestiones puedo hacer por teléfono?",
    answer: "Consultar huecos, reservar, cambiar o anular una cita, y darse de alta como paciente nuevo.",
  },
  {
    id: "faq-seguros",
    question: "¿Con qué aseguradoras trabajáis?",
    answer: "Sanitas, Adeslas, DKV, ASISA, Mapfre, Caser, Cigna y AXA, y pacientes privados. La cobertura se comprueba para esa especialidad y ese profesional.",
  },
  {
    id: "faq-documentacion",
    question: "¿Qué datos necesito para identificarme?",
    answer: "Con el teléfono suele bastar. Si hay varias fichas, pedirá DNI o NIE o fecha de nacimiento.",
  },
  {
    id: "faq-paciente-nuevo",
    question: "¿Puedo darme de alta como paciente nuevo?",
    answer: "Sí. Nombre y apellidos, DNI o NIE, fecha de nacimiento, teléfono, correo y aseguradora.",
  },
  {
    id: "faq-urgencias",
    question: "¿Qué ocurre si tengo una urgencia?",
    answer: "No da consejo médico. Si hay signos de urgencia, pasa la llamada a una persona de admisión.",
  },
  {
    id: "faq-privacidad",
    question: "¿Queda grabada la llamada?",
    answer: "La llamada queda en el registro de admisión para explicar qué se hizo. Si pide privacidad, no se pasa la transcripción al transferir; el registro de la cita se conserva.",
  },
] as const;

export function hospitalProfile(orgSlug: string): { metaPrompt: string; extraInstructions: string } {
  const organisation = organisationOf(orgSlug);
  const name = organisation?.name ?? "el hospital";
  const sites = organisation?.sites ?? [];
  const siteLine = sites.length
    ? sites.map((site) => `${site.name} (${site.city})`).join(", ")
    : "las sedes que figuren en el directorio clínico";
  const arenalPolicy = orgSlug === "arenal"
    ? " Si no indican sede, pregunta. Centro abre sábados; Norte y Sur no. Ningún centro abre domingo."
    : " Si no indican sede y hay más de una, pregunta antes de buscar agenda.";
  return {
    metaPrompt: `Atiendes el teléfono de ${name}. Habla en español de España, profesional, cercano y breve. No inventes horarios, sedes ni coberturas.`,
        extraInstructions: `Hospital: ${name}. Sedes: ${siteLine}. Identifícate siempre como ${name}.${arenalPolicy} No des consejo médico. Si hay urgencia o piden una persona, pasa la llamada.`,
  };
}
