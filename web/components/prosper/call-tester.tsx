"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { prosper, ProsperError } from "@/lib/prosper-client";
import { useProblems } from "@/lib/prosper-hooks";
import { ErrorState, LoadingRows } from "./query-state";

// Guarda el último endpoint usado en el navegador (comodidad, no viaja a nadie).
const KEY = "wl-endpoint";

export function CallTester() {
  const problems = useProblems();
  const [problemId, setProblemId] = useState("simple_booking");
  const [endpoint, setEndpoint] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [result, setResult] = useState<Record<string, { run_id?: string; error?: string; loading?: boolean }>>({});

  const detail = useQuery({
    queryKey: ["problem", problemId],
    queryFn: () => prosper.problem(problemId),
    enabled: !!problemId,
  });

  const call = async (caseId: string) => {
    setResult((r) => ({ ...r, [caseId]: { loading: true } }));
    try {
      const { run_id } = await prosper.triggerCall({ problem_id: problemId, case_id: caseId, endpoint: endpoint.trim() });
      setResult((r) => ({ ...r, [caseId]: { run_id } }));
    } catch (e) {
      setResult((r) => ({ ...r, [caseId]: { error: e instanceof ProsperError ? e.message : String(e) } }));
    }
  };

  if (problems.error) return <ErrorState error={problems.error} onRetry={() => problems.refetch()} />;
  if (!problems.data) return <LoadingRows />;

  const endpointOk = /^wss:\/\//.test(endpoint.trim());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Probar caso</h1>
        <p className="text-sm text-muted-foreground">
          Dispara un Call de un caso público contra tu endpoint. No es Run All, no puntúa, no toca Settings.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div>
            <label className="mb-1 block font-heading text-[10px] uppercase tracking-wide">Endpoint (wss://…/ws)</label>
            <Input
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                try {
                  localStorage.setItem(KEY, e.target.value);
                } catch {}
              }}
              placeholder="wss://tu-tunel.ngrok-free.dev/ws"
              className="font-mono text-xs"
            />
            {!endpointOk && endpoint && <p className="mt-1 text-xs text-hs-red">Debe empezar por wss://</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {problems.data.problems.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProblemId(p.id)}
                className={`border-2 px-2 py-1 font-heading text-[10px] uppercase tracking-wide ${
                  p.id === problemId ? "border-foreground bg-primary" : "border-transparent text-muted-foreground hover:border-foreground"
                }`}
              >
                {p.id}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{problemId}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!detail.data && <LoadingRows n={3} />}
          {detail.data?.examples.map((ex) => {
            const r = result[ex.case_id];
            return (
              <div key={ex.case_id} className="flex items-center justify-between gap-3 border-2 border-foreground p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{ex.caller}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{ex.case_id}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r?.run_id && <Badge className="bg-hs-teal text-hs-cream">run {r.run_id.slice(0, 8)}</Badge>}
                  {r?.error && <span className="max-w-56 truncate text-xs text-hs-red" title={r.error}>{r.error}</span>}
                  <Button size="sm" disabled={!endpointOk || r?.loading} onClick={() => call(ex.case_id)}>
                    {r?.loading ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
                    Call
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
