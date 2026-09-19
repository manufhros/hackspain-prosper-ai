import { organisationOf } from "./orgs";

export const HOSPITAL_FAQ = [
  {
    id: "faq-centros",
    question: "¿Qué centros tenéis?",
    answer: "La red de demostración dispone de Centro, Norte y Sur. El agente consulta la disponibilidad del centro que prefiera el paciente.",
  },
  {
    id: "faq-sabado",
    question: "¿Qué centro abre los sábados?",
    answer: "Centro abre los sábados. Norte y Sur permanecen cerrados. Ningún centro abre los domingos.",
  },
  {
    id: "faq-gestiones",
    question: "¿Qué gestiones puedo hacer por teléfono?",
    answer: "Puede consultar disponibilidad, reservar, cambiar o cancelar una cita y registrarse como paciente nuevo.",
  },
  {
    id: "faq-seguros",
    question: "¿Con qué aseguradoras trabajáis?",
    answer: "Se admiten Sanitas, Adeslas, DKV, ASISA, Mapfre, Caser, Cigna, AXA, Nueva Mutua y pacientes privados. La cobertura concreta se comprueba para cada especialidad y profesional.",
  },
  {
    id: "faq-documentacion",
    question: "¿Qué datos necesito para identificarme?",
    answer: "El agente puede localizar la ficha por teléfono. Si hay varias coincidencias, solicitará DNI o NIE o fecha de nacimiento para verificar la identidad.",
  },
  {
    id: "faq-paciente-nuevo",
    question: "¿Puedo darme de alta como paciente nuevo?",
    answer: "Sí. Se solicitarán nombre y apellidos, DNI o NIE, fecha de nacimiento, teléfono, correo electrónico y aseguradora.",
  },
  {
    id: "faq-urgencias",
    question: "¿Qué ocurre si tengo una urgencia médica?",
    answer: "El agente no ofrece consejo médico. Ante señales de urgencia escala inmediatamente la llamada al equipo humano.",
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
    extraInstructions: `Hospital: ${name}. Sedes: ${siteLine}. Identifícate siempre como ${name}.${arenalPolicy} No des consejo médico. Ante urgencia o si piden una persona, escala.`,
  };
}
