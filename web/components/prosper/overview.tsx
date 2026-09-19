"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBoard, useTeam } from "@/lib/prosper-hooks";
import { cn } from "@/lib/utils";
import { ErrorState, LoadingRows } from "./query-state";

const ago = (iso: string | null) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "ahora" : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
};

export function Overview() {
  const team = useTeam();
  const board = useBoard();

  if (team.error) return <ErrorState error={team.error} onRetry={() => team.refetch()} />;
  if (!team.data) return <LoadingRows />;
  const { stats, integration, name } = team.data;
  const maxFail = Math.max(1, ...stats.field_failures.map((f) => f.failures));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{name}</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Pass rate" value={`${Math.round(stats.pass_rate * 100)}%`} sub={`${stats.cases_passed}/${stats.cases_judged} casos`} />
        <Stat label="Mejor puntuación" value={stats.best_points ?? "—"} sub={stats.rank ? `#${stats.rank}` : "sin rank"} />
        <Stat label="Runs" value={stats.runs} sub={`${stats.private_runs} privados`} />
        <Stat label="Harness errors" value={stats.harness_errors} sub="no cuentan como fallo del agente" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Endpoint del agente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", integration.key_active ? "bg-hs-teal" : "bg-hs-red")} />
              {integration.key_active ? "Key activa" : "Key inactiva"}
            </div>
            <p className="text-muted-foreground">Última llamada: {ago(integration.last_call_at)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Fallos por campo</CardTitle>
            <CardDescription>Dónde se equivoca más el agente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.field_failures.length === 0 && <p className="text-sm text-muted-foreground">Sin fallos 🎉</p>}
            {[...stats.field_failures]
              .sort((a, b) => b.failures - a.failures)
              .map((f) => (
                <div key={f.field} className="space-y-1">
                  <div className="flex justify-between font-mono text-xs">
                    <span>{f.field}</span>
                    <span>{f.failures}</span>
                  </div>
                  <div className="h-1.5 bg-muted">
                    <div className="h-full bg-hs-red" style={{ width: `${(f.failures / maxFail) * 100}%` }} />
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              Clasificación {board.data?.frozen && <Badge variant="secondary">congelada</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {board.error ? (
              <p className="text-sm text-muted-foreground">No disponible</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead className="text-right">Pts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.data?.entries.map((e) => (
                    <TableRow key={e.name} className={cn(e.name === name && "bg-muted font-medium")}>
                      <TableCell>{e.rank}</TableCell>
                      <TableCell>{e.name}</TableCell>
                      <TableCell className="text-right">{e.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Submissions recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hora</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Call</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.data.submissions.slice(0, 15).map((s) => (
                <TableRow key={s.call_id + s.submitted_at}>
                  <TableCell className="text-xs">{new Date(s.submitted_at).toLocaleTimeString("es-ES")}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.outcome}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.detail}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.call_id.slice(0, 8)}
                    {!s.known_call && <span className="ml-1 text-hs-orange">desconocida</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>
    </Card>
  );
}
