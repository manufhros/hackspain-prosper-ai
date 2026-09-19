"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClinic, usePatients } from "@/lib/prosper-hooks";
import { ErrorState, LoadingRows } from "./query-state";

const PAGE = 50;

// Insurers/locations/appointment types no están inspeccionados: se muestran como JSON.
const j = (v: unknown) => <pre className="max-w-md overflow-auto text-xs">{JSON.stringify(v)}</pre>;

export function ClinicView() {
  const { data, error, refetch } = useClinic();
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <LoadingRows />;

  const extra = Object.entries(data).filter(
    ([k, v]) =>
      Array.isArray(v) && !["restrictions", "providers", "specialties"].includes(k),
  ) as [string, unknown[]][];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{data.clinic_name}</h1>
        <p className="text-sm text-muted-foreground">
          {data.patient_count} pacientes · {data.calendar.starts} → {data.calendar.ends} · slots de{" "}
          {data.calendar.slot_minutes} min · cierres: {data.calendar.closure_days.join(", ") || "ninguno"}
        </p>
      </div>
      <Tabs defaultValue="providers">
        <TabsList className="flex-wrap">
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="specialties">Specialties</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          {extra.map(([k]) => (
            <TabsTrigger key={k} value={k}>
              {k.replace(/_/g, " ")}
            </TabsTrigger>
          ))}
          <TabsTrigger value="patients">Pacientes</TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Especialidad</TableHead>
                    <TableHead>Idiomas</TableHead>
                    <TableHead>Sedes</TableHead>
                    <TableHead>Tipos de cita</TableHead>
                    <TableHead>Aseguradoras</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id}</TableCell>
                      <TableCell>
                        {p.name} {p.leave != null && <Badge variant="outline">baja</Badge>}
                      </TableCell>
                      <TableCell>{p.specialty_name}</TableCell>
                      <TableCell>{p.languages.join(", ")}</TableCell>
                      <TableCell>{p.location_names.join(", ")}</TableCell>
                      <TableCell className="text-xs">{p.appointment_type_names.join(", ")}</TableCell>
                      <TableCell>
                        {j({ ok: p.accepted_insurers, no: p.refused_insurers })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="specialties">
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Edad mín (meses)</TableHead>
                    <TableHead>Edad máx (meses)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.specialties.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.id}</TableCell>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.min_age_months}</TableCell>
                      <TableCell>{s.max_age_months ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          {data.restrictions.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-1">
                <div className="font-medium">{r.title}</div>
                <p className="text-sm text-muted-foreground">{r.explanation}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {extra.map(([k, rows]) => (
          <TabsContent key={k} value={k}>
            <Card>
              <CardContent>
                <pre className="max-h-[70vh] overflow-auto text-xs">{JSON.stringify(rows, null, 2)}</pre>
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="patients">
          <Patients />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Patients() {
  const [offset, setOffset] = useState(0);
  const { data, error, isFetching, refetch } = usePatients(offset, PAGE);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <LoadingRows />;

  return (
    <Card>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>DNI</TableHead>
              <TableHead>Nacimiento</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Seguro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.patients.map((p) => (
              <TableRow key={p.patient_id}>
                <TableCell className="font-mono text-xs">{p.patient_id}</TableCell>
                <TableCell>
                  {p.given_name} {p.first_surname} {p.second_surname}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.national_id}</TableCell>
                <TableCell>{p.date_of_birth}</TableCell>
                <TableCell className="font-mono text-xs">{p.phone}</TableCell>
                <TableCell>{j(p.insurer)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE, data.total)} de {data.total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0 || isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Anterior
            </Button>
            <Button size="sm" variant="outline" disabled={offset + PAGE >= data.total || isFetching} onClick={() => setOffset(offset + PAGE)}>
              Siguiente
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
