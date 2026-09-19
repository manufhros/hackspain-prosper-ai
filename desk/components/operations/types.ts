export type Entry = { type: string; at: number; text?: string; name?: string; result?: string; language?: string; toolCallId?: string; params?: unknown };
export type Call = { id: string; name: string; source: "llm" | "phone" | "mock"; state: string; started: number; ended?: number; events: Entry[] };
export type Run = { id: string; state: string; message: string; calls: Call[] };
export const toolLabels: Record<string, string> = {
  search_directory: "Identificar paciente", search_availability: "Buscar disponibilidad",
  list_appointments: "Consultar citas", submit_book: "Reservar cita",
  submit_escalate: "Escalar a una persona", submit_register: "Registrar paciente",
  submit_reschedule: "Cambiar cita", submit_cancel: "Cancelar cita", submit_no_action: "Cerrar consulta",
};
export const activeRun = (run: Run) => ["preparing", "running", "stopping", "uncertain"].includes(run.state);
export function isDecision(entry: Entry) {
  if (entry.type !== "tool_result" || !entry.name?.startsWith("submit_") || !entry.result) return false;
  try {
    const result = JSON.parse(entry.result);
    return result.accepted === true && result.simulated === true && !result.error;
  } catch { return false; }
}
export const duration = (from: number, to: number) => {
  const seconds = Math.max(0, Math.floor((to - from) / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
