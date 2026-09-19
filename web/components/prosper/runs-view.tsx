"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRunNotes, useTeam } from "@/lib/prosper-hooks";
import type { RunNote } from "@/lib/prosper-types";
import type { Run } from "@/lib/prosper-types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";
import { CaseDetail } from "./case-detail";
import { ErrorState, LoadingRows } from "./query-state";

const ALL = "all";

export function RunsView({ kind }: { kind: "run-all" | "tests" }) {
  const { data, error, isLoading, refetch, isFetching } = useTeam();
  const notes = useRunNotes().data;
  const [state, setState] = useState(ALL);
  const [problem, setProblem] = useState(ALL);
  const [runId, setRunId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  const problems = useMemo(
    () => [...new Set(data?.runs.flatMap((r) => r.cases.map((c) => c.problem_id)) ?? [])].sort(),
    [data],
  );

  const runs = useMemo(
    () =>
      (data?.runs ?? []).filter(
        (r) =>
          (state === ALL || r.state === state) &&
          (kind === "tests" ? r.public : !r.public) &&
          (problem === ALL || r.cases.some((c) => c.problem_id === problem)),
      ),
    [data, state, problem, kind],
  );

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <LoadingRows />;

  const run = runs.find((r) => r.run_id === runId) ?? runs[0];
  const cases = run?.cases.filter((c) => problem === ALL || c.problem_id === problem) ?? [];
  const selected = cases.find((c) => c.call_id === callId) ?? cases[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{kind === "tests" ? "Tests nuestros" : "Run All (scored)"}</h1>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            <SelectItem value="running">running</SelectItem>
            <SelectItem value="completed">completed</SelectItem>
            <SelectItem value="failed">failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={problem} onValueChange={setProblem}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los problemas</SelectItem>
            {problems.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{runs.length} runs</span>
        {data.runs.some((r) => r.state === "running") && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full bg-hs-navy", isFetching && "animate-ping")} />
            En vivo · actualiza cada 5 s
          </span>
        )}
      </div>

      {run && (
        <ScoreBanner
          run={run}
          best={kind === "run-all" ? data.stats.best_points : undefined}
          rank={kind === "run-all" ? data.stats.rank : undefined}
        />
      )}

      {run && notes?.[run.run_id] && <RunNotePanel note={notes[run.run_id]} />}

      <div className="grid grid-cols-[16rem_18rem_1fr] items-start gap-4">
        <Card className="max-h-[75vh] gap-0 overflow-auto p-1">
          {runs.map((r) => {
            const passed = r.cases.filter((c) => c.status === "passed").length;
            return (
              <Row key={r.run_id} active={r.run_id === run?.run_id} onClick={() => (setRunId(r.run_id), setCallId(null))}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">
                    {r.run_id.slice(0, 8)}
                    {notes?.[r.run_id] && <span title="Tiene notas de análisis"> 📝</span>}
                  </span>
                  <StatusBadge status={r.state} />
                </div>
                <div className="mt-1 flex items-end justify-between">
                  <div className="text-xs text-muted-foreground">
                    <div>{new Date(r.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</div>
                    <div>
                      {r.cases.length ? `${passed}/${r.cases.length} passed` : "sin casos"}
                      {r.voided && " · void"}
                    </div>
                  </div>
                  {r.cases.length > 0 && (
                    <div className="tabular-nums">
                      <span className="font-heading text-2xl leading-none">{score(r).got}</span>
                      <span className="text-sm text-muted-foreground"> / {score(r).max || "?"}</span>
                    </div>
                  )}
                </div>
              </Row>
            );
          })}
          {runs.length === 0 && <p className="p-3 text-sm text-muted-foreground">Sin runs.</p>}
        </Card>

        <Card className="max-h-[75vh] gap-0 overflow-auto p-1">
          {run?.explanation && <p className="border-b p-3 text-xs text-muted-foreground">{run.explanation}</p>}
          {cases.map((c) => (
            <Row key={c.call_id} active={c.call_id === selected?.call_id} onClick={() => setCallId(c.call_id)}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{c.label}</span>
                <StatusBadge status={c.status} />
              </div>
              {c.signal_codes.length > 0 && (
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{c.signal_codes.join(", ")}</div>
              )}
            </Row>
          ))}
          {cases.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              Sin casos{run && !run.public && run.state === "failed" ? " (el run falló antes de crear llamadas)" : ""}.
            </p>
          )}
        </Card>

        <div className="min-w-0">
          {selected ? (
            <CaseDetail key={selected.call_id} c={selected} submission={data.submissions.find((s) => s.call_id === selected.call_id)} note={run && notes?.[run.run_id]?.calls[selected.call_id]} />
          ) : <p className="text-sm text-muted-foreground">Selecciona un caso.</p>}
        </div>
      </div>
    </div>
  );
}

function RunNotePanel({ note }: { note: RunNote }) {
  return (
    <details className="rounded-none border-[3px] border-hs-orange bg-card p-4 text-sm" open>
      <summary className="cursor-pointer font-medium">📝 {note.title}</summary>
      <p className="mt-2">{note.summary}</p>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {note.findings.map((f) => (
          <li key={f.title} className="rounded-none bg-muted p-2">
            <div className="font-medium">{f.title}</div>
            <div className="text-xs text-muted-foreground">{f.detail}</div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Fuente: {note.source}</p>
    </details>
  );
}

const score = (r: Run) => ({
  got: r.cases.reduce((n, c) => n + (c.points ?? 0), 0),
  max: r.cases.reduce((n, c) => n + (c.points_available ?? 0), 0),
});

function ScoreBanner({ run, best, rank }: { run: Run; best?: number | null; rank?: number | null }) {
  const { got, max } = score(run);
  const count = (st: string) => run.cases.filter((c) => c.status === st).length;
  const live = run.state === "running";
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-none border-[3px] border-foreground bg-card p-5">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Puntos de este run {live && <span className="ml-1 animate-pulse text-hs-navy">● en vivo</span>}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-7xl tabular-nums leading-none text-hs-orange">{got}</span>
          <span className="text-3xl text-muted-foreground tabular-nums">/ {max || "?"}</span>
        </div>
      </div>
      <div className="min-w-48 flex-1 space-y-2">
        <div className="h-3 overflow-hidden bg-muted">
          <div className="h-full bg-hs-teal transition-all" style={{ width: `${max ? (got / max) * 100 : 0}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span className="text-hs-teal">{count("passed")} passed</span>
          <span className="text-hs-red">{count("failed")} failed</span>
          <span className="text-hs-orange">{count("harness_error")} harness</span>
          <span className="text-hs-navy">{count("active")} en curso</span>
        </div>
      </div>
      {best !== undefined && (
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Mejor Run All · ranking</div>
          <div className="text-4xl font-bold tabular-nums">
            {best ?? "—"} <span className="text-2xl text-muted-foreground">{rank ? `#${rank}` : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("w-full rounded-none px-3 py-2 text-left transition-colors hover:bg-muted", active && "bg-muted")}
    >
      {children}
    </button>
  );
}
