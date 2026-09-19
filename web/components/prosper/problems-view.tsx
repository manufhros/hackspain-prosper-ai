"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProblem, useProblemSubmissions, useProblems, useTeam } from "@/lib/prosper-hooks";
import { CaseDetail } from "./case-detail";
import { StatusBadge } from "./badges";
import { ErrorState, LoadingRows } from "./query-state";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function ProblemsList() {
  const problems = useProblems();
  const team = useTeam();
  if (problems.error) return <ErrorState error={problems.error} onRetry={() => problems.refetch()} />;
  if (!problems.data) return <LoadingRows />;

  // passed/failed por problema, calculado desde los runs (sin 6 peticiones extra)
  const tally = new Map<string, { passed: number; failed: number }>();
  for (const r of team.data?.runs ?? [])
    for (const c of r.cases) {
      const t = tally.get(c.problem_id) ?? { passed: 0, failed: 0 };
      if (c.status === "passed") t.passed++;
      else if (c.status === "failed") t.failed++;
      tally.set(c.problem_id, t);
    }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Problemas</h1>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Problema</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>Ejemplos</TableHead>
                <TableHead>Passed</TableHead>
                <TableHead>Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {problems.data.problems.map((p) => {
                const t = tally.get(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.number}</TableCell>
                    <TableCell>
                      <Link href={`/problems/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{p.id}</div>
                    </TableCell>
                    <TableCell>{p.weight}</TableCell>
                    <TableCell>{p.examples}</TableCell>
                    <TableCell className="text-hs-teal">{t?.passed ?? "—"}</TableCell>
                    <TableCell className="text-hs-red">{t?.failed ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProblemDetailView({ id }: { id: string }) {
  const problem = useProblem(id);
  const subs = useProblemSubmissions(id);
  const [open, setOpen] = useState<string | null>(null);

  if (problem.error) return <ErrorState error={problem.error} onRetry={() => problem.refetch()} />;
  if (!problem.data) return <LoadingRows />;
  const attempt = subs.data?.attempts.find((a) => a.case.call_id === open);

  return (
    <div className="space-y-6">
      <Link href="/problems" className="text-sm text-muted-foreground hover:text-foreground">
        ← Problemas
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{problem.data.title}</h1>
        <Badge variant="secondary">peso {problem.data.weight}</Badge>
      </div>

      <Card>
        <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">{problem.data.statement}</CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {problem.data.examples.map((e) => (
          <Card key={e.case_id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {e.caller} <span className="font-mono text-xs font-normal text-muted-foreground">{e.case_id}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{e.summary}</p>
              <pre className="overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.accepted, null, 2)}</pre>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">
          Intentos {subs.data && <span className="text-sm font-normal text-muted-foreground">· {subs.data.passed} passed / {subs.data.failed} failed</span>}
        </h2>
        {subs.error ? (
          <ErrorState error={subs.error} />
        ) : !subs.data ? (
          <LoadingRows n={4} />
        ) : (
          <div className="grid grid-cols-[20rem_1fr] items-start gap-4">
            <Card className="max-h-[70vh] gap-0 overflow-auto p-1">
              {subs.data.attempts.map((a) => (
                <button
                  key={a.case.call_id}
                  type="button"
                  onClick={() => setOpen(a.case.call_id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-none px-3 py-2 text-left hover:bg-muted",
                    a.case.call_id === attempt?.case.call_id && "bg-muted",
                  )}
                >
                  <div>
                    <div className="text-sm">{a.case.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </div>
                  <StatusBadge status={a.case.status} />
                </button>
              ))}
            </Card>
            <div className="min-w-0">
              {attempt ? <CaseDetail key={attempt.case.call_id} c={attempt.case} /> : <p className="text-sm text-muted-foreground">Selecciona un intento.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
