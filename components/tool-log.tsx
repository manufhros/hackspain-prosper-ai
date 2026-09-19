"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { explainTool } from "@/lib/tools/catalog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TranscriptTurn } from "@/lib/cases/transcript";

const LABELS: Record<string, string> = {
  name: "Nombre",
  national_id: "DNI",
  phone: "Teléfono",
  location_id: "Sede",
  specialty_id: "Especialidad",
  patient_id: "Paciente",
  provider_id: "Médico",
  date_from: "Desde",
  date_to: "Hasta",
  slot: "Hueco",
  appointment_id: "Cita",
  appointment_type_id: "Tipo",
  policy_id: "Póliza",
  insurer: "Aseguradora",
  given_name: "Nombre",
  first_surname: "Apellido",
  second_surname: "Segundo apellido",
  date_of_birth: "Nacimiento",
  email: "Email",
  reason: "Motivo",
};

function kindOf(name: string) {
  if (name.startsWith("submit_")) return { label: "Escribe", variant: "default" as const };
  return { label: "Consulta", variant: "secondary" as const };
}

function fieldLabel(key: string) {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

export function ToolLog({ turns }: { turns: TranscriptTurn[] }) {
  const tools = turns.filter((turn): turn is Extract<TranscriptTurn, { kind: "tool" }> => turn.kind === "tool");
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Auditoría</h2>
        <p className="text-xs text-muted-foreground">
          Pulsa una tool para ver la consulta concreta y lo que devolvió el ERP.
        </p>
      </div>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no ha consultado el sistema.</p>
      ) : (
        <div className="divide-y rounded-xl border bg-background">
          {tools.map((tool, index) => {
            const info = explainTool(tool.name, tool.reason);
            const kind = kindOf(info.name);
            const open = openId === tool.id;
            const entries = Object.entries(tool.input ?? {}).filter(([, value]) => value);
            return (
              <div key={tool.id} className="didactic-in">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : tool.id)}
                >
                  <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                  <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                  <Badge variant={kind.variant}>{kind.label}</Badge>
                  <span className="min-w-0 truncate font-medium">{info.label}</span>
                </button>
                {open ? (
                  <div className="space-y-3 border-t bg-muted/40 px-3 py-3 text-sm">
                    <p>
                      <span className="text-muted-foreground">Tool: </span>
                      <code className="font-mono text-xs">{info.name}</code>
                    </p>
                    <div>
                      <p className="mb-1 text-muted-foreground">Consulta</p>
                      {entries.length ? (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          {entries.map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt className="text-muted-foreground">{fieldLabel(key)}</dt>
                              <dd className="min-w-0 break-words font-mono text-xs">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p>Sin parámetros</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-muted-foreground">Respuesta del ERP</p>
                      <p className="whitespace-pre-wrap break-words">{tool.result || "Sin datos"}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
