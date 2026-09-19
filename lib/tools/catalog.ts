export type ToolInfo = {
  label: string;
  meaning: string;
};

const CATALOG: Record<string, ToolInfo> = {
  search_directory: {
    label: "Buscar en directorio",
    meaning: "Consulta pacientes, médicos o centros en el ERP de la clínica.",
  },
  search_availability: {
    label: "Buscar huecos",
    meaning: "Pide al ERP qué franjas hay libres para un médico, centro o servicio.",
  },
  list_appointments: {
    label: "Listar citas",
    meaning: "Lee las citas ya existentes de un paciente.",
  },
  submit_book: {
    label: "Reservar cita",
    meaning: "Confirma y escribe una reserva nueva en la agenda.",
  },
  submit_cancel: {
    label: "Cancelar cita",
    meaning: "Elimina una cita existente.",
  },
  submit_reschedule: {
    label: "Mover cita",
    meaning: "Cancela el hueco actual y reserva otro.",
  },
  submit_register: {
    label: "Alta de paciente",
    meaning: "Crea la ficha de alguien que aún no está en el directorio.",
  },
  submit_no_action: {
    label: "Cerrar sin cambios",
    meaning: "La llamada no requiere escribir nada en la agenda.",
  },
  submit_escalate: {
    label: "Escalar",
    meaning: "Pasa el caso a un humano cuando el agente no puede resolverlo.",
  },
};

const TOOL_NAMES = Object.keys(CATALOG);

export const SIMULATE_TOOL_NAMES = TOOL_NAMES;

export function explainTool(rawName: string, reason?: string): ToolInfo & { name: string } {
  const name = rawName.trim().replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
  const key = name.toLowerCase();
  const known = CATALOG[key];
  if (known) return { name: key, ...known };

  if (/avail|slot|schedule|hueco|agenda/i.test(name)) {
    return { name, ...CATALOG.search_availability };
  }
  if (/appoint|cita|list_/i.test(name)) {
    return { name, ...CATALOG.list_appointments };
  }
  if (/book|reserv/i.test(name)) {
    return { name, ...CATALOG.submit_book };
  }
  if (/cancel/i.test(name)) {
    return { name, ...CATALOG.submit_cancel };
  }
  if (/resched|mover/i.test(name)) {
    return { name, ...CATALOG.submit_reschedule };
  }
  if (/register|alta/i.test(name)) {
    return { name, ...CATALOG.submit_register };
  }
  if (/escalat/i.test(name)) {
    return { name, ...CATALOG.submit_escalate };
  }
  if (/directory|lookup|search|find|doctor|derm/i.test(name)) {
    return { name, ...CATALOG.search_directory };
  }

  return {
    name,
    label: name.replace(/_/g, " "),
    meaning: reason?.trim() || "Consulta interna del agente al sistema de la clínica.",
  };
}
