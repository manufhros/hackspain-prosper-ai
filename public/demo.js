export function demoAvailability(now = Date.now(), count = 4) {
  const slots = Array.from({ length: count }, (_, index) => {
    const date = new Date(now + (index + 2) * 86400000);
    date.setUTCHours(14, 30, 0, 0);
    return {
      start_time: date.toISOString(),
      provider_id: "DEMO-DR-01",
      provider_name: "Dra. Vega · demostración",
      location_id: "centro",
      location_name: "Arenal Centro",
      appointment_type_id: "dermatology_review",
    };
  });
  return {
    soonest: slots[0],
    slots,
    saturday: [],
    blocked: [],
    appointment_type_id: "dermatology_review",
  };
}

// This fixture is only shown after the user explicitly opens demonstration mode.
export function createDemo(now = Date.now()) {
  const stamp = (seconds) => new Date(now + seconds * 1000).toISOString();
  const messages = [
    ["agent", "Buenos días, soy Lucía. ¿En qué puedo ayudarte?", -134],
    ["user", "Quería una cita de dermatología.", -120],
    ["agent", "Gracias, Elena. Voy a consultar la disponibilidad.", -107],
    ["agent", "Hay opciones la próxima semana. ¿Qué horario prefieres?", -70],
    ["user", "Mejor por la tarde.", -35],
    ["agent", "De acuerdo, estoy buscando citas por la tarde.", -5],
  ];
  const active = {
    id: "demo-elena",
    name: "Elena Martín",
    phone: "Paciente de demostración",
    status: "active",
    startedAt: stamp(-134),
    connected: true,
    revision: 1,
    transcript: messages.map(([role, text, seconds], index) => ({
      id: `demo-message-${index}`,
      role,
      text,
      at: stamp(seconds),
    })),
    tools: [
      {
        id: "demo-tool-1",
        name: "search_directory",
        input: { name: "Elena Martín" },
        output: {
          matches: [
            {
              patient_id: "DEMO-01",
              given_name: "Elena",
              first_surname: "Martín",
            },
          ],
        },
        status: "completed",
        startedAt: stamp(-113),
        endedAt: stamp(-112.818),
        durationMs: 182,
      },
      {
        id: "demo-tool-2",
        name: "search_availability",
        input: { specialty_id: "dermatology", patient_id: "DEMO-01" },
        output: demoAvailability(now),
        status: "completed",
        startedAt: stamp(-81),
        endedAt: stamp(-80.66),
        durationMs: 340,
      },
      {
        id: "demo-tool-3",
        name: "search_availability",
        input: { specialty_id: "dermatology", patient_id: "DEMO-01" },
        status: "running",
        startedAt: stamp(-0.8),
      },
    ],
  };
  const history = [
    ["Carlos Ruiz", -1100, 232, "completed"],
    ["Ana López", -2150, 260, "completed"],
    ["Javier Pérez", -3430, 0, "missed"],
    ["Marta Sánchez", -65000, 156, "completed"],
    ["David Gómez", -71100, 303, "completed"],
    ["Laura Torres", -77200, 225, "completed"],
    ["Sergio Díaz", -80800, 0, "missed"],
  ].map(([name, offset, length, status], index) => ({
    id: `demo-${index}`,
    name,
    phone: "Paciente de demostración",
    status,
    connected: status === "completed",
    startedAt: stamp(offset),
    endedAt: stamp(offset + length),
    revision: 1,
    transcript:
      status === "completed"
        ? [
            {
              id: `past-${index}-1`,
              role: "user",
              text: "Hola, quería consultar el horario de la clínica.",
              at: stamp(offset + 5),
            },
            {
              id: `past-${index}-2`,
              role: "agent",
              text: "Por supuesto. ¿Sobre qué sede te gustaría consultar?",
              at: stamp(offset + 12),
            },
          ]
        : [],
    tools: [],
  }));
  return [active, ...history];
}
