export const STATUS = {
  active: { label: "En curso", icon: "circle", className: "active" },
  completed: {
    label: "Finalizada",
    icon: "check-circle",
    className: "completed",
  },
  missed: { label: "No atendida", icon: "phone-x", className: "missed" },
  failed: { label: "Error", icon: "warning-circle", className: "failed" },
  interrupted: {
    label: "Interrumpida",
    icon: "pause-circle",
    className: "interrupted",
  },
};
export const TOOL_NAMES = {
  search_directory: ["Buscar paciente", "magnifying-glass"],
  search_availability: ["Consultar disponibilidad", "calendar-blank"],
  list_appointments: ["Consultar citas", "calendar-dots"],
  submit_book: ["Reservar cita", "calendar-check"],
  submit_cancel: ["Cancelar cita", "calendar-x"],
  submit_reschedule: ["Cambiar cita", "calendar"],
  submit_register: ["Registrar paciente", "user-plus"],
  submit_no_action: ["Registrar resultado", "note"],
  submit_escalate: ["Derivar llamada", "arrow-bend-up-right"],
};
const timeOptions = { timeZone: "Europe/Madrid" };
export function clinicalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
    return String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    ...timeOptions,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}
export const time = (date, seconds = false) =>
  new Date(date).toLocaleTimeString("es-ES", {
    ...timeOptions,
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
export const dayKey = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    ...timeOptions,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export function dayLabel(date, now = new Date()) {
  const key = dayKey(date);
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  if (key === dayKey(now)) return "Hoy";
  if (key === dayKey(previous)) return "Ayer";
  return new Date(date).toLocaleDateString("es-ES", {
    ...timeOptions,
    day: "numeric",
    month: "long",
  });
}
export function duration(start, end = Date.now()) {
  const seconds = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export const normalize = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
export function filterCalls(calls, query) {
  const search = normalize(query.trim());
  return calls
    .filter((call) =>
      normalize(`${call.name} ${call.phone} ${call.id}`).includes(search),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function summary(call) {
  const { transcript, tools, ...rest } = call;
  return { ...rest, messages: transcript.length, toolCount: tools.length };
}
