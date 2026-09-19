import { escapeHTML as esc, clinicalDate } from "./model.js";

const LABELS = {
  patient_id: "Paciente",
  provider_id: "Profesional",
  provider_name: "Profesional",
  location_id: "Sede",
  location_name: "Sede",
  appointment_id: "Cita",
  appointment_type_id: "Tipo de consulta",
  specialty_id: "Especialidad",
  policy_id: "Cobertura",
  insurer: "Seguro",
  name: "Nombre",
  given_name: "Nombre",
  first_surname: "Primer apellido",
  second_surname: "Segundo apellido",
  national_id: "Documento de identidad",
  date_of_birth: "Nacimiento",
  phone: "Teléfono",
  email: "Correo electrónico",
  sex: "Sexo",
  has_visited_before: "Visitas anteriores",
  referrals: "Derivaciones",
  note: "Nota",
  match_score: "Puntuación de coincidencia",
  matched_fields: "Campos coincidentes",
  date_from: "Desde",
  date_to: "Hasta",
  slot: "Fecha y hora",
  start_time: "Fecha y hora",
  duration_minutes: "Duración",
  reason: "Motivo",
  restriction: "Restricción",
  payable_with: "Coberturas admitidas",
  received_at: "Recibido",
  call_id: "Llamada",
  action: "Acción",
  new_patient: "Paciente",
  accepted_insurers: "Seguros admitidos",
  locations: "Sedes",
  languages: "Idiomas",
  on_leave_until: "Ausente hasta",
  new_patient_requirement: "Tipo de paciente",
  guidance: "Indicaciones",
  id: "Identificador",
  error: "Error",
  message: "Mensaje",
  detail: "Detalle",
  status: "Estado",
  when: "Periodo",
  available_slots: "Huecos disponibles",
};

const REASONS = {
  not_eligible_age: "Edad fuera del intervalo admitido",
  referral_required: "Se necesita una derivación",
  provider_not_in_network: "El profesional no acepta este seguro",
  specialty_not_covered: "El seguro no cubre esta especialidad",
  location_not_covered: "El seguro no cubre esta sede",
  insurer_referral_required: "El seguro exige una derivación",
  allowance_exhausted: "Límite de consultas del seguro agotado",
  provider_on_leave: "Profesional ausente",
  location_hours: "Fuera del horario de la sede",
  type_not_offered: "Tipo de consulta no disponible",
  patient_history: "Restricción por historial del paciente",
  no_availability: "Sin disponibilidad",
  clinic_closed: "Clínica cerrada",
  patient_not_found: "Paciente no encontrado",
  provider_not_found: "Profesional no encontrado",
  caller_not_authorised: "La persona que llama no está autorizada",
  out_of_scope: "Solicitud fuera del alcance del servicio",
  medical_emergency: "Urgencia médica",
};

const SPECIALTIES = {
  orthopaedics: "Traumatología",
  dermatology: "Dermatología",
  gynaecology: "Ginecología",
  paediatrics: "Pediatría",
  general_practice: "Medicina general",
  physiotherapy: "Fisioterapia",
};
const TYPES = {
  first_visit: "Primera visita",
  review: "Revisión",
  orthopaedic_first_visit: "Primera visita de traumatología",
  orthopaedic_review: "Revisión de traumatología",
  dermatology_first_visit: "Primera visita de dermatología",
  dermatology_review: "Revisión de dermatología",
  gynaecology_first_visit: "Primera visita de ginecología",
  gynaecology_review: "Revisión de ginecología",
  paediatric_first_visit: "Primera visita de pediatría",
  paediatric_review: "Revisión de pediatría",
  physiotherapy_session: "Sesión de fisioterapia",
};
const INSURERS = {
  sanitas: "Sanitas",
  adeslas: "Adeslas",
  dkv: "DKV",
  asisa: "ASISA",
  mapfre: "Mapfre",
  caser: "Caser",
  cigna: "Cigna",
  axa: "AXA",
  nueva_mutua: "Nueva Mutua",
  privado: "Privado",
};
const LOCATIONS = {
  centro: "Arenal Centro",
  norte: "Arenal Norte",
  sur: "Arenal Sur",
};
const ACTIONS = {
  BOOK: "Reserva registrada",
  CANCEL: "Cancelación registrada",
  RESCHEDULE: "Cambio de cita registrado",
  REGISTER: "Alta de paciente registrada",
  NO_ACTION: "Sin gestión adicional",
  ESCALATE: "Derivación registrada",
};
const ERRORS = {
  "patient_id required": "Falta identificar al paciente.",
  "appointment_id required": "Falta identificar la cita.",
  "reason required": "Falta indicar el motivo.",
  "missing book fields": "Faltan datos necesarios para reservar la cita.",
  "missing register fields":
    "Faltan datos necesarios para registrar al paciente.",
  "missing reschedule fields": "Faltan datos necesarios para cambiar la cita.",
};
const own = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const label = (key) =>
  own(LABELS, key) ??
  key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const fullName = (value) =>
  [value.given_name, value.first_surname, value.second_surname]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
export function parseToolPayload(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Names come only from this run and earlier successful runs in the same call.
// IDs remain visible when the call has never supplied a matching name.
function references(tool, tools) {
  const refs = new Map();
  const remember = (kind, id, name) => {
    if (typeof id === "string" && typeof name === "string" && name.trim())
      refs.set(`${kind}:${id}`, name);
  };
  const slot = (value) => {
    if (!object(value)) return;
    remember("provider_id", value.provider_id, value.provider_name);
    remember("location_id", value.location_id, value.location_name);
  };
  const index = tools.findIndex(
    (run) => run === tool || (tool.id && run.id === tool.id),
  );
  const available = index < 0 ? [tool] : tools.slice(0, index + 1);
  for (const run of available) {
    if (run.status !== "completed") continue;
    const output = parseToolPayload(run.output);
    if (!object(output) || output.error) continue;
    if (run.name === "search_directory" && Array.isArray(output.matches)) {
      for (const match of output.matches.filter(object))
        remember("patient_id", match.patient_id, fullName(match));
    }
    if (run.name === "search_availability") {
      for (const item of [
        ...(Array.isArray(output.slots) ? output.slots : []),
        ...(Array.isArray(output.saturday) ? output.saturday : []),
        output.soonest,
      ])
        slot(item);
      if (Array.isArray(output.providers))
        for (const provider of output.providers.filter(object))
          remember("provider_id", provider.id, provider.name);
      if (object(output.appointment_type))
        remember(
          "appointment_type_id",
          output.appointment_type.id,
          output.appointment_type.name,
        );
    }
  }
  return refs;
}

function display(key, value, refs) {
  if (value === null || value === undefined || value === "") return "Sin datos";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value !== "string" && typeof value !== "number")
    return String(value);
  const named = refs.get(`${key}:${value}`);
  if (named) return `${named} · ${value}`;
  if (
    [
      "slot",
      "start_time",
      "date_from",
      "date_to",
      "date_of_birth",
      "received_at",
      "on_leave_until",
    ].includes(key)
  )
    return clinicalDate(value);
  if (key === "duration_minutes") return `${value} min`;
  if (["reason", "restriction"].includes(key))
    return own(REASONS, value) ?? String(value);
  if (
    ["insurer", "policy_id", "accepted_insurers", "payable_with"].includes(key)
  )
    return own(INSURERS, value) ?? String(value);
  if (["location_id", "locations"].includes(key))
    return own(LOCATIONS, value) ?? String(value);
  if (["specialty_id", "referrals"].includes(key))
    return own(SPECIALTIES, value) ?? String(value);
  if (key === "appointment_type_id") return own(TYPES, value) ?? String(value);
  if (key === "matched_fields") return label(String(value));
  if (key === "action") return own(ACTIONS, value) ?? String(value);
  if (key === "error") return own(ERRORS, value) ?? String(value);
  if (key === "when")
    return (
      own(
        {
          upcoming: "Próximas citas",
          past: "Citas anteriores",
          all: "Todas las citas",
        },
        value,
      ) ?? String(value)
    );
  if (key === "sex")
    return (
      own(
        {
          female: "Femenino",
          male: "Masculino",
          F: "Femenino",
          M: "Masculino",
        },
        value,
      ) ?? String(value)
    );
  return String(value);
}

function values(value, refs, key = "", depth = 0) {
  if (depth > 5)
    return '<span class="tool-muted">Consultar detalles técnicos</span>';
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="tool-muted">Ninguno</span>';
    return `<ul class="tool-values">${value.map((item) => `<li>${values(item, refs, key, depth + 1)}</li>`).join("")}</ul>`;
  }
  if (object(value)) return fields(value, refs, [], depth + 1);
  return esc(display(key, value, refs));
}
function fields(data, refs, omit = [], depth = 0) {
  if (!object(data)) return values(data, refs, "", depth);
  const entries = Object.entries(data).filter(([key]) => {
    if (omit.includes(key)) return false;
    if (key === "provider_name" && refs.has(`provider_id:${data.provider_id}`))
      return false;
    if (key === "location_name" && refs.has(`location_id:${data.location_id}`))
      return false;
    return true;
  });
  if (!entries.length)
    return '<p class="tool-muted">Sin datos adicionales.</p>';
  return `<dl class="tool-fields">${entries.map(([key, value]) => `<div><dt>${esc(label(key))}</dt><dd>${values(value, refs, key, depth)}</dd></div>`).join("")}</dl>`;
}
const section = (title, content, tone = "") =>
  `<section class="tool-section ${tone}"><h4>${esc(title)}</h4>${content}</section>`;
const message = (text) => `<p class="tool-message">${esc(text)}</p>`;
const count = (size, singular, plural) =>
  `${size} ${size === 1 ? singular : plural}`;
function cards(items, refs, title, omit = []) {
  return `<ol class="tool-results">${items.map((item, index) => `<li>${section(title(item, index), fields(item, refs, omit))}</li>`).join("")}</ol>`;
}
function outputPresentation(tool, output, refs) {
  if (tool.status === "failed" || (object(output) && output.error)) {
    const error = object(output)
      ? (output.error ??
        output.message ??
        "La herramienta terminó con un error. Consulta los detalles técnicos.")
      : output;
    return {
      summary: "No se pudo completar",
      html: section(
        "No se pudo completar",
        output === undefined
          ? message("No se recibió un resultado.")
          : fields({ error }, refs),
        "tool-section-error",
      ),
    };
  }
  if (tool.status === "running")
    return {
      summary: "Esperando respuesta…",
      html: section("En ejecución", message("Esperando respuesta…")),
    };
  if (tool.status === "interrupted")
    return {
      summary: "Ejecución interrumpida",
      html: section(
        "Ejecución interrumpida",
        message("No hay un resultado confirmado."),
        "tool-section-warning",
      ),
    };
  if (output === undefined || output === null)
    return {
      summary: "Sin resultado",
      html: section("Resultado", message("No se recibió un resultado.")),
    };
  if (
    tool.name === "search_directory" &&
    object(output) &&
    Array.isArray(output.matches)
  ) {
    const summary = count(
      output.matches.length,
      "paciente encontrado",
      "pacientes encontrados",
    );
    return {
      summary,
      html: section(
        summary,
        output.matches.length
          ? cards(output.matches, refs, (patient, i) =>
              object(patient)
                ? fullName(patient) || `Paciente ${i + 1}`
                : `Resultado ${i + 1}`,
            )
          : message("No se encontraron pacientes con estos datos."),
      ),
    };
  }
  if (
    tool.name === "search_availability" &&
    object(output) &&
    Array.isArray(output.slots)
  ) {
    const summary = count(
      output.slots.length,
      "horario disponible",
      "horarios disponibles",
    );
    const slotTitle = (slot, i) =>
      object(slot) && slot.start_time
        ? clinicalDate(slot.start_time)
        : `Horario ${i + 1}`;
    let html = section(
      summary,
      output.slots.length
        ? cards(output.slots, refs, slotTitle)
        : message("No hay horarios disponibles para esta búsqueda."),
    );
    if (output.soonest)
      html =
        section("Primera disponibilidad", fields(output.soonest, refs)) + html;
    if (Array.isArray(output.saturday) && output.saturday.length)
      html += section(
        "Opciones en sábado",
        cards(output.saturday, refs, slotTitle),
      );
    if (Array.isArray(output.blocked) && output.blocked.length)
      html += section(
        "Restricciones encontradas",
        cards(output.blocked, refs, () => "No disponible"),
        "tool-section-warning",
      );
    const extra = Object.fromEntries(
      Object.entries(output).filter(
        ([key]) => !["slots", "soonest", "saturday", "blocked"].includes(key),
      ),
    );
    if (Object.keys(extra).length)
      html += section("Información de la consulta", fields(extra, refs));
    return { summary, html };
  }
  if (
    tool.name === "list_appointments" &&
    object(output) &&
    Array.isArray(output.appointments)
  ) {
    const summary = count(
      output.appointments.length,
      "cita encontrada",
      "citas encontradas",
    );
    return {
      summary,
      html: section(
        summary,
        output.appointments.length
          ? cards(output.appointments, refs, (item, i) =>
              object(item) && item.start_time
                ? clinicalDate(item.start_time)
                : `Cita ${i + 1}`,
            )
          : message("No se encontraron citas para este paciente."),
      ),
    };
  }
  if (
    tool.name.startsWith("submit_") &&
    object(output) &&
    object(output.record) &&
    Array.isArray(output.record.actions)
  ) {
    const actions = output.record.actions;
    // The receipt can contain several actions: show all, without attributing the
    // entire record to the current tool or synthesizing fields from its request.
    const summary = actions.length
      ? "Registro recibido"
      : "Registro sin acciones";
    const html =
      section(
        summary,
        output.received_at
          ? fields({ received_at: output.received_at }, refs)
          : message("Respuesta de la clínica recibida."),
      ) +
      section(
        "Acciones del registro",
        actions.length
          ? cards(actions, refs, (action) =>
              object(action)
                ? (own(ACTIONS, action.action) ?? "Acción registrada")
                : "Acción registrada",
            )
          : message("La respuesta no contiene acciones registradas."),
      );
    return { summary, html };
  }
  return {
    summary: "Respuesta recibida",
    html: section("Resultado", fields(output, refs)),
  };
}

export function presentTool(tool, tools = [tool]) {
  const refs = references(tool, tools);
  const result = outputPresentation(tool, parseToolPayload(tool.output), refs);
  return {
    summary: result.summary,
    html:
      result.html +
      section(
        "Solicitud",
        tool.input === undefined
          ? message("Sin parámetros.")
          : fields(parseToolPayload(tool.input), refs),
      ),
  };
}
