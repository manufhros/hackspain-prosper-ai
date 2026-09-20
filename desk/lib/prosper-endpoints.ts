export type ProsperEndpoint = {
  method: "GET" | "POST";
  path: string;
  url: string;
  label: string;
  copy: string;
};

const ORIGIN = "https://hackspain.getprosperapp.com";

function route(method: ProsperEndpoint["method"], path: string, label: string, copy: string): ProsperEndpoint {
  return { method, path, url: `${ORIGIN}${path}`, label, copy };
}

/** Clinic system the agent actually calls. Not hospital-owned URLs. */
export const PROSPER_ENDPOINTS: ProsperEndpoint[] = [
  route("GET", "/api/v1/health", "Salud", "Si la API responde."),
  route("GET", "/api/v1/clinic", "Clínica", "Sedes, restricciones y ventana de reserva."),
  route("GET", "/api/v1/directory", "Directorio", "Busca al paciente por nombre, DNI o teléfono."),
  route("GET", "/api/v1/availability", "Disponibilidad", "Huecos reales para reservar."),
  route("GET", "/api/v1/patients/{patient_id}/appointments", "Citas del paciente", "Agenda. Única fuente del appointment_id."),
  route("GET", "/api/v1/providers", "Profesionales", "Quién trabaja, idiomas y planes."),
  route("GET", "/api/v1/locations", "Sedes", "Centro, Norte y Sur."),
  route("GET", "/api/v1/specialties", "Especialidades", "Edad, derivación y cobertura."),
  route("GET", "/api/v1/appointment-types", "Tipos de cita", "Duración y especialidad."),
  route("GET", "/api/v1/insurance-plans", "Pólizas", "Qué cubre cada plan."),
  route("POST", "/api/v1/submit/book", "Reservar", "Registra una cita hecha."),
  route("POST", "/api/v1/submit/register", "Alta", "Paciente que no estaba en ficha."),
  route("POST", "/api/v1/submit/reschedule", "Cambiar cita", "Mueve una cita existente."),
  route("POST", "/api/v1/submit/cancel", "Anular", "Cancela una cita."),
  route("POST", "/api/v1/submit/no-action", "Sin acción", "Cierra sin escribir en agenda."),
  route("POST", "/api/v1/submit/escalate", "Escalar", "Pasa la llamada a una persona."),
  route("GET", "/api/v1/submissions", "Envíos", "Lo reportado en las llamadas."),
];

/** Agent tool name → Prosper path. Catalog GETs have no live tool. */
export const TOOL_PATH: Record<string, string> = {
  search_directory: "/api/v1/directory",
  search_availability: "/api/v1/availability",
  list_appointments: "/api/v1/patients/{patient_id}/appointments",
  submit_book: "/api/v1/submit/book",
  submit_register: "/api/v1/submit/register",
  submit_reschedule: "/api/v1/submit/reschedule",
  submit_cancel: "/api/v1/submit/cancel",
  submit_no_action: "/api/v1/submit/no-action",
  submit_escalate: "/api/v1/submit/escalate",
};

export const CATALOG_PATHS = new Set([
  "/api/v1/health",
  "/api/v1/clinic",
  "/api/v1/providers",
  "/api/v1/locations",
  "/api/v1/specialties",
  "/api/v1/appointment-types",
  "/api/v1/insurance-plans",
  "/api/v1/submissions",
]);

export const HOOK_PATH = {
  preCallEndpoint: "/api/v1/directory",
  actionEndpoint: "/api/v1/availability",
  postCallEndpoint: "/api/v1/submissions",
} as const;

export function defaultRoutes(): Record<string, string> {
  return Object.fromEntries(PROSPER_ENDPOINTS.map((item) => [item.path, item.url]));
}

export function routesFromConfig(input: {
  routes?: Record<string, string>;
  preCallEndpoint?: string;
  actionEndpoint?: string;
  postCallEndpoint?: string;
}): Record<string, string> {
  const merged = { ...defaultRoutes(), ...input.routes };
  const legacy: Array<[string, string | undefined]> = [
    [HOOK_PATH.preCallEndpoint, input.preCallEndpoint],
    [HOOK_PATH.actionEndpoint, input.actionEndpoint],
    [HOOK_PATH.postCallEndpoint, input.postCallEndpoint],
  ];
  for (const [path, value] of legacy) {
    if (value?.trim()) merged[path] = value.trim();
  }
  return Object.fromEntries(
    PROSPER_ENDPOINTS.map((item) => [item.path, (merged[item.path] ?? item.url).trim() || item.url]),
  );
}

export function hooksFromRoutes(routes: Record<string, string>) {
  return {
    preCallEndpoint: routes[HOOK_PATH.preCallEndpoint] ?? "",
    actionEndpoint: routes[HOOK_PATH.actionEndpoint] ?? "",
    postCallEndpoint: routes[HOOK_PATH.postCallEndpoint] ?? "",
  };
}
