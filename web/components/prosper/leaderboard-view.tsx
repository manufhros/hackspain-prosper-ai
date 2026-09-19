"use client";

import { Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBoard, useTeam } from "@/lib/prosper-hooks";
import { cn } from "@/lib/utils";
import { ErrorState, LoadingRows } from "./query-state";

const PODIUM = [
  { h: "h-32", bg: "bg-hs-yellow", label: "1º" },
  { h: "h-24", bg: "bg-hs-teal text-hs-cream", label: "2º" },
  { h: "h-20", bg: "bg-hs-orange text-hs-cream", label: "3º" },
];
// Orden visual del podio: 2 · 1 · 3
const ORDER = [1, 0, 2];

export function LeaderboardView() {
  const { data, error, refetch } = useBoard();
  const me = useTeam().data?.name;

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <LoadingRows />;

  const top = data.entries.slice(0, 3);
  const rest = data.entries.slice(3);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Clasificación</h1>
        {data.frozen && <Badge variant="secondary">congelada</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          Actualizada: {new Date(data.generated_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
        </span>
      </div>

      {/* Podio */}
      <div className="grid grid-cols-3 items-end gap-3">
        {ORDER.map((idx, col) => {
          const e = top[idx];
          if (!e) return <div key={col} />;
          const p = PODIUM[idx];
          const mine = e.name === me;
          return (
            <div key={e.name} className="hs-chat-in flex flex-col items-center gap-2" style={{ animationDelay: `${col * 60}ms` }}>
              <div className={cn("text-center", mine && "font-semibold")}>
                {idx === 0 && <Crown className="mx-auto mb-1 size-5 text-hs-yellow" />}
                <div className="truncate font-heading text-sm uppercase">{e.name}</div>
                <div className="font-heading text-2xl tabular-nums text-hs-orange">{e.points}</div>
              </div>
              <div
                className={cn(
                  "flex w-full items-start justify-center border-2 border-foreground pt-2 font-heading text-lg",
                  p.h,
                  p.bg,
                  mine && "ring-4 ring-hs-orange ring-offset-2 ring-offset-background",
                )}
              >
                {p.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resto de la tabla */}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead className="text-right">Puntos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rest.map((e) => {
                const mine = e.name === me;
                return (
                  <TableRow key={e.name} className={cn(mine && "bg-primary/20 font-semibold")}>
                    <TableCell className="font-heading tabular-nums">{e.rank}</TableCell>
                    <TableCell>
                      {e.name}
                      {mine && <span className="ml-2 text-xs text-hs-orange">tú</span>}
                    </TableCell>
                    <TableCell className="text-right font-heading tabular-nums">{e.points}</TableCell>
                  </TableRow>
                );
              })}
              {rest.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    Solo hay {data.entries.length} equipos en el ranking.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
