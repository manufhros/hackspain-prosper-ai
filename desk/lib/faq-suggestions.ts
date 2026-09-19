import type { LoggedCall } from "./types";

export type FaqSuggestion = {
  id: string;
  question: string;
  answer: string;
  count: number;
  evidence: string;
};

const TOPICS = [
  {
    id: "hours",
    pattern: /horario|abre|abierto|sábado|domingo|festivo/i,
    question: "¿Cuál es el horario de los centros?",
    answer:
      "Centro abre los sábados; Norte y Sur permanecen cerrados. Ningún centro abre los domingos. Para días laborables, el agente consulta el horario publicado del centro.",
  },
  {
    id: "insurance",
    pattern: /seguro|asegur|póliza|sanitas|adeslas|dkv|mapfre|caser|cigna|axa/i,
    question: "¿Cómo compruebo si mi seguro cubre la cita?",
    answer:
      "Indique su aseguradora y la especialidad. El agente comprobará la cobertura concreta para el profesional y el centro solicitados.",
  },
  {
    id: "locations",
    pattern: /centro|norte|sur|getafe|ubicación|dirección|cerca/i,
    question: "¿En qué centro puedo pedir la cita?",
    answer:
      "Puede elegir Centro, Norte o Sur. El agente comprueba qué sede atiende la especialidad y ofrece disponibilidad en el centro elegido.",
  },
  {
    id: "changes",
    pattern: /cancel|anul|cambiar|mover|reprogram/i,
    question: "¿Puedo cambiar o cancelar una cita por teléfono?",
    answer:
      "Sí. Tras verificar la identidad, el agente consulta las próximas citas y puede cancelar o cambiar la seleccionada.",
  },
  {
    id: "registration",
    pattern: /alta|nuevo paciente|registr/i,
    question: "¿Cómo me registro como paciente nuevo?",
    answer:
      "El agente solicitará nombre y apellidos, DNI o NIE, fecha de nacimiento, teléfono, correo electrónico y aseguradora.",
  },
  {
    id: "availability",
    pattern: /hueco|disponib|primera cita|cita antes|mañana|tarde/i,
    question: "¿Cómo encuentro la primera cita disponible?",
    answer:
      "Indique especialidad, profesional, centro y preferencia horaria. El agente consultará la agenda real y ofrecerá el primer hueco compatible.",
  },
] as const;

export function suggestFaqs(calls: LoggedCall[]): FaqSuggestion[] {
  const suggestions = TOPICS.map((topic) => {
    const matches = calls.filter((call) => topic.pattern.test(call.motive));
    return {
      id: topic.id,
      question: topic.question,
      answer: topic.answer,
      count: matches.length,
      evidence: matches[0]?.motive ?? "",
    };
  })
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  if (suggestions.length) return suggestions;
  const specialtyCalls = calls.filter((call) =>
    /medicina|trauma|gine|derma|pedia|cardio/i.test(call.motive),
  );
  if (specialtyCalls.length < 2) return [];
  return [
    {
      id: "specialties",
      question: "¿Qué especialidades atendéis?",
      answer:
        "La red atiende medicina general, dermatología, traumatología, ginecología, pediatría y fisioterapia. El agente comprueba el profesional y centro disponibles.",
      count: specialtyCalls.length,
      evidence: specialtyCalls[0]?.motive ?? "",
    },
  ];
}
