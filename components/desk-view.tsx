"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CLINIC_LOCATIONS, CLINIC_SPECIALTIES } from "@/lib/clinic/options";
import type {
  Appointment,
  AvailabilitySlot,
  ClinicCatalog,
  ClinicSourceInfo,
  PatientMatch,
} from "@/lib/clinic/types";

type Props = {
  source: ClinicSourceInfo;
  health: { ok: boolean; detail?: string };
  catalog?: ClinicCatalog;
};

function catalogOptions(
  items: unknown[] | undefined,
  fallback: ReadonlyArray<{ id: string; label: string }>,
) {
  const parsed = (items ?? [])
    .map((item) => {
      if (typeof item === "string") return { id: item, label: item };
      if (!item || typeof item !== "object") return null;
      const record = item as { id?: string; name?: string; label?: string };
      if (!record.id) return null;
      return { id: record.id, label: record.name ?? record.label ?? record.id };
    })
    .filter((item): item is { id: string; label: string } => Boolean(item));
  return parsed.length ? parsed : [...fallback];
}

function ymd(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function patientName(patient: PatientMatch) {
  return [patient.given_name, patient.first_surname, patient.second_surname]
    .filter(Boolean)
    .join(" ");
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

export function DeskView({ source, health, catalog }: Props) {
  const locations = catalogOptions(catalog?.locations, CLINIC_LOCATIONS);
  const specialties = catalogOptions(catalog?.specialties, CLINIC_SPECIALTIES);
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [matches, setMatches] = useState<PatientMatch[]>([]);
  const [selected, setSelected] = useState<PatientMatch | null>(null);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [dateFrom, setDateFrom] = useState(ymd(1));
  const [dateTo, setDateTo] = useState(ymd(14));
  const [locationId, setLocationId] = useState("any");
  const [specialtyId, setSpecialtyId] = useState("any");
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [register, setRegister] = useState({
    given_name: "",
    first_surname: "",
    second_surname: "",
    national_id: "",
    date_of_birth: "",
    phone: "",
    email: "",
    insurer: "privado",
  });

  const step = !searched ? 1 : !selected ? 2 : 3;

  async function search() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (name) params.set("name", name);
      if (nationalId) params.set("national_id", nationalId);
      if (phone) params.set("phone", phone);
      if (dob) params.set("date_of_birth", dob);
      const data = await readJson<{ matches: PatientMatch[] }>(
        await fetch(`/api/clinic/directory?${params}`),
      );
      setSearched(true);
      setMatches(data.matches);
      const first = data.matches[0] ?? null;
      setSelected(first);
      setRegister((current) => ({
        ...current,
        given_name: name.split(" ")[0] || current.given_name,
        national_id: nationalId || current.national_id,
        phone: phone || current.phone,
        date_of_birth: dob || current.date_of_birth,
      }));
      if (first) await loadChart(first.patient_id);
      else {
        setUpcoming([]);
        setSlots([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "directory failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadChart(patientId: string) {
    const next = await readJson<{ appointments: Appointment[] }>(
      await fetch(`/api/clinic/appointments?patient_id=${encodeURIComponent(patientId)}&when=upcoming`),
    );
    setUpcoming(next.appointments);
  }

  async function searchSlots() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (selected) params.set("patient_id", selected.patient_id);
      if (locationId && locationId !== "any") params.set("location_id", locationId);
      if (specialtyId && specialtyId !== "any") params.set("specialty_id", specialtyId);
      if (selected?.insurer) params.append("insurer", selected.insurer);
      const data = await readJson<{ slots: AvailabilitySlot[] }>(
        await fetch(`/api/clinic/availability?${params}`),
      );
      setSlots(data.slots);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "availability failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await readJson(
        await fetch("/api/clinic/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, call_id: "desk" }),
        }),
      );
      const action = String(payload.action);
      setLastAction(action);
      toast.success(action);
      if (selected) await loadChart(selected.patient_id);
      if (action === "REGISTER") await search();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function book(slot: AvailabilitySlot) {
    if (rescheduleId) {
      await submit({
        action: "RESCHEDULE",
        appointment_id: rescheduleId,
        provider_id: slot.provider_id,
        location_id: slot.location_id,
        slot: slot.start_time,
        policy_id: selected?.insurer || "privado",
      });
      setRescheduleId(null);
      return;
    }
    if (!selected) {
      toast.error("Identifica al paciente primero");
      return;
    }
    await submit({
      action: "BOOK",
      patient_id: selected.patient_id,
      provider_id: slot.provider_id,
      location_id: slot.location_id,
      appointment_type_id: slot.appointment_type_id,
      slot: slot.start_time,
      policy_id: selected.insurer || "privado",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl tracking-tight">Mostrador</h1>
        <p className="text-sm text-muted-foreground">
          Flujo de teleoperador: identificar, ver la ficha, ofrecer hueco y confirmar.
          {health.ok ? "" : " · clínica no disponible"}
          {source.kind === "fixture" ? " · datos de prueba" : ` · ${source.name}`}
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          ["1", "Identificar"],
          ["2", "Ficha"],
          ["3", "Agendar"],
        ].map(([n, label], index) => (
          <li
            key={n}
            className={`rounded-lg border px-3 py-2 text-sm ${
              step === index + 1 ? "border-primary bg-primary/10" : "text-muted-foreground"
            }`}
          >
            <span className="font-mono text-xs">{n}</span> {label}
          </li>
        ))}
      </ol>

      {lastAction ? (
        <p className="text-sm">
          Última acción: <Badge>{lastAction}</Badge>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>1. Identificar al llamante</CardTitle>
          <CardDescription>Busca por nombre, DNI, teléfono o fecha de nacimiento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nombre" value={name} onChange={setName} />
            <Field label="DNI / NIE" value={nationalId} onChange={setNationalId} />
            <Field label="Teléfono" value={phone} onChange={setPhone} />
            <Field label="Nacimiento" value={dob} onChange={setDob} placeholder="YYYY-MM-DD" />
          </div>
          <Button nativeButton onClick={() => void search()} disabled={busy}>
            {busy ? "Buscando…" : "Buscar paciente"}
          </Button>
          {searched ? (
            <ul className="divide-y rounded-lg border">
              {matches.map((match, index) => (
                <li key={`${match.patient_id}-${index}`}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      selected?.patient_id === match.patient_id ? "bg-muted" : ""
                    }`}
                    onClick={() => {
                      setSelected(match);
                      void loadChart(match.patient_id);
                    }}
                  >
                    <span>
                      <span className="font-medium">{patientName(match)}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {match.national_id} · {match.insurer ?? "—"}
                      </span>
                    </span>
                    <Badge variant="secondary">{match.has_visited_before ? "conocido" : "nuevo"}</Badge>
                  </button>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  Sin ficha. Pasa al alta en el paso 2.
                </li>
              ) : null}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {searched && selected ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Ficha de {patientName(selected)}</CardTitle>
            <CardDescription>
              {selected.date_of_birth} · {selected.insurer ?? "sin plan"} · citas próximas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {selected.note ? <p>{selected.note}</p> : null}
            <AppointmentList
              rows={upcoming}
              onCancel={(id) => void submit({ action: "CANCEL", appointment_id: id })}
              onReschedule={(id) => setRescheduleId(id)}
              rescheduleId={rescheduleId}
            />
          </CardContent>
        </Card>
      ) : null}

      {searched && !selected ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Alta de paciente</CardTitle>
            <CardDescription>No está en el directorio. Crea la ficha antes de agendar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre" value={register.given_name} onChange={(value) => setRegister({ ...register, given_name: value })} />
              <Field label="Primer apellido" value={register.first_surname} onChange={(value) => setRegister({ ...register, first_surname: value })} />
              <Field label="Segundo apellido" value={register.second_surname} onChange={(value) => setRegister({ ...register, second_surname: value })} />
              <Field label="DNI / NIE" value={register.national_id} onChange={(value) => setRegister({ ...register, national_id: value })} />
              <Field label="Nacimiento" value={register.date_of_birth} onChange={(value) => setRegister({ ...register, date_of_birth: value })} />
              <Field label="Teléfono" value={register.phone} onChange={(value) => setRegister({ ...register, phone: value })} />
              <Field label="Email" value={register.email} onChange={(value) => setRegister({ ...register, email: value })} />
              <Field label="Aseguradora" value={register.insurer} onChange={(value) => setRegister({ ...register, insurer: value })} />
            </div>
            <Button nativeButton disabled={busy} onClick={() => void submit({ action: "REGISTER", ...register })}>
              Dar de alta
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>3. {rescheduleId ? "Mover cita" : "Buscar hueco y confirmar"}</CardTitle>
            <CardDescription>
              {rescheduleId
                ? `Elige un hueco para ${rescheduleId}`
                : "Filtra, ofrece un hueco y reserva."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Desde" value={dateFrom} onChange={setDateFrom} />
              <Field label="Hasta" value={dateTo} onChange={setDateTo} />
              <SelectField
                label="Sede"
                value={locationId}
                onChange={setLocationId}
                options={[{ id: "any", label: "Cualquiera" }, ...locations]}
              />
              <SelectField
                label="Especialidad"
                value={specialtyId}
                onChange={setSpecialtyId}
                options={[{ id: "any", label: "Cualquiera" }, ...specialties]}
              />
            </div>
            <Button nativeButton variant="outline" onClick={() => void searchSlots()} disabled={busy}>
              Ver huecos
            </Button>
            <ul className="divide-y rounded-lg border">
              {slots.map((slot) => (
                <li key={`${slot.provider_id}-${slot.start_time}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{slot.start_time}</div>
                    <div className="text-xs text-muted-foreground">
                      {slot.provider_name ?? slot.provider_id} · {slot.location_id} · {slot.appointment_type_id}
                    </div>
                  </div>
                  <Button nativeButton size="sm" disabled={busy} onClick={() => void book(slot)}>
                    {rescheduleId ? "Mover aquí" : "Reservar"}
                  </Button>
                </li>
              ))}
              {slots.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Sin huecos cargados.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(String(next ?? "any"))}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function AppointmentList({
  rows,
  onCancel,
  onReschedule,
  rescheduleId,
}: {
  rows: Appointment[];
  onCancel: (id: string) => void;
  onReschedule: (id: string) => void;
  rescheduleId: string | null;
}) {
  if (!rows.length) return <p className="text-muted-foreground">No hay citas próximas.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.appointment_id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <div>
            <div className="font-medium">{row.start_time}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {row.provider_id} · {row.location_id}
            </div>
          </div>
          <div className="flex gap-1">
            <Button nativeButton size="xs" variant="outline" onClick={() => onReschedule(row.appointment_id)}>
              {rescheduleId === row.appointment_id ? "Eligiendo hueco" : "Mover"}
            </Button>
            <Button nativeButton size="xs" variant="destructive" onClick={() => onCancel(row.appointment_id)}>
              Cancelar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
