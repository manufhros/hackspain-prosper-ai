"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CaseRunResult } from "@/lib/cases/types";

type ListedCase = {
  id: string;
  problem_id: string;
  weight: number;
  language: string;
  summary: string;
  expected: string[];
};

export function CasesBoard({ cases }: { cases: ListedCase[] }) {
  const [filter, setFilter] = useState("all");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, CaseRunResult>>({});
  const [source, setSource] = useState<string>("");

  const problems = useMemo(() => {
    const ids = [...new Set(cases.map((item) => item.problem_id))];
    return ids;
  }, [cases]);

  const visible = filter === "all" ? cases : cases.filter((item) => item.problem_id === filter);
  const passed = Object.values(results).filter((item) => item.passed).length;
  const total = Object.keys(results).length;

  async function run(ids?: string[]) {
    setRunning(true);
    try {
      const response = await fetch("/api/cases/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json()) as {
        source: { name: string; kind: string };
        passed: number;
        failed: number;
        results: CaseRunResult[];
      };
      setSource(`${data.source.name} (${data.source.kind})`);
      setResults(Object.fromEntries(data.results.map((item) => [item.caseId, item])));
      toast.success(`${data.passed} passed · ${data.failed} failed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Public cases</CardTitle>
          <CardDescription>
            {cases.length} published practice cases from the challenge roster. Run All
            checks the connected clinic data — directory, availability and diary —
            against each expected action. It does not place a phone call.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button nativeButton onClick={() => run()} disabled={running}>
            {running ? "Running…" : "Run all"}
          </Button>
          <Button
            nativeButton
            variant="outline"
            onClick={() => run(visible.map((item) => item.id))}
            disabled={running}
          >
            Run visible
          </Button>
          {source ? (
            <span className="text-sm text-muted-foreground">
              {source}
              {total ? ` · ${passed}/${total}` : ""}
            </span>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-1.5">
        <Button
          nativeButton
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          all
        </Button>
        {problems.map((problem) => (
          <Button
            key={problem}
            nativeButton
            size="sm"
            variant={filter === problem ? "default" : "outline"}
            onClick={() => setFilter(problem)}
          >
            {problem}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
            <TableHead>Problem</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Result</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((item) => {
            const result = results[item.id];
            return (
              <TableRow key={item.id}>
                <TableCell className="max-w-md">
                  <div className="font-medium">{item.summary}</div>
                  <div className="text-xs text-muted-foreground">{item.id}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{item.problem_id}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{item.expected.join(" + ")}</TableCell>
                <TableCell>
                  {result ? (
                    <Badge variant={result.passed ? "default" : "destructive"}>
                      {result.passed ? "pass" : "fail"}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {result ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {result.checks.map((check) => `${check.name}: ${check.detail}`).join(" · ")}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Button
                    nativeButton
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={() => run([item.id])}
                  >
                    Run
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
