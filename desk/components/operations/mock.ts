import type { Run } from "./types";

/** Offline only: never opens a provider session or writes to Prosper. */
export function mockRun(tick: number, started: number): Run {
  const scenarios = [
    { name: "María García", language: "es", messages: [
      "Hola, Clínica Arenal. ¿En qué puedo ayudarte?", "Quiero una cita de medicina general.",
      "¿Me confirmas tu nombre?", "María García.",
      "Tengo un hueco mañana a las diez. ¿Te viene bien?", "Sí, gracias.",
      "La reserva de ensayo ha quedado registrada.",
    ], tool: "submit_book" },
    { name: "Camille Laurent", language: "fr", messages: [
      "Hola, Clínica Arenal. ¿En qué puedo ayudarte?", "Bonjour, je voudrais prendre rendez-vous.",
      "Bien sûr. Quel est votre nom ?", "Camille Laurent. Je voudrais parler à une personne.",
      "Je vais demander l’aide de notre équipe.",
    ], tool: "submit_escalate" },
    { name: "Diego Romero", language: "es", messages: [
      "Hola, Clínica Arenal. ¿En qué puedo ayudarte?", "¿Abrís los sábados?",
      "La recepción abre de lunes a viernes.", "Gracias, eso era todo.",
      "Gracias por llamar.",
    ], tool: "submit_no_action" },
  ];
  return { id: "offline", state: tick > 10 ? "finished" : "running", message: "Simulación local · Sin consumo de API", calls: scenarios.map((scenario, index) => {
    const step = Math.max(0, tick - index);
    const ended = step > scenario.messages.length + 1;
    return { id: `mock-${index}`, name: scenario.name, source: "mock", started: started + index * 1800,
      state: ended ? "Finalizada" : step ? "En conversación" : "Entrante",
      ...(ended ? { ended: started + (scenario.messages.length + index + 1) * 1800 } : {}),
      events: [
        ...scenario.messages.slice(0, step).map((text, i) => ({ type: i % 2 ? "user" : "agent", text, at: started + (i + index) * 1800, ...(i % 2 ? { language: scenario.language } : {}) })),
        ...(ended ? [{ type: "tool_result", name: scenario.tool, result: JSON.stringify({ accepted: true, simulated: true }), at: started + (scenario.messages.length + index) * 1800 }] : []),
      ],
    };
  }) };
}
