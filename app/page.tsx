import Link from "next/link";
import { getClinicSource } from "@/lib/clinic/source";
import { loadPublicCases } from "@/lib/cases/load";
import { PROBLEM_WEIGHTS } from "@/lib/cases/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage() {
  const source = getClinicSource();
  const health = await source.health();
  const cases = loadPublicCases();
  const problems = new Set(cases.map((item) => item.problem_id)).size;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Clinic data layer</p>
        <h1 className="font-heading text-3xl tracking-tight">Plug any clinic into the same contract</h1>
        <p className="max-w-2xl text-muted-foreground">
          The voice agent, the judge and this console only talk to a clinic through
          the documented EHR surface: directory, availability, appointments and a
          read-only catalogue. Point the connector at Prosper, or at another ERP
          that implements the same routes.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
            <CardDescription>{source.info.name}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {health.ok ? "Healthy" : "Unreachable"}
            {health.detail ? ` · ${health.detail}` : ""}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Public cases</CardTitle>
            <CardDescription>Practice roster</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {cases.length} cases · {problems} problems · max {Object.values(PROBLEM_WEIGHTS).reduce((a, b) => a + b, 0)} pts
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contract</CardTitle>
            <CardDescription>From the clinic docs</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            GET clinic / directory / availability / appointments · POST submit/*
          </CardContent>
        </Card>
      </div>
      <div className="flex gap-2">
        <Button nativeButton render={<Link href="/connectors" />}>
          Connect clinic
        </Button>
        <Button nativeButton variant="outline" render={<Link href="/cases" />}>
          Run public cases
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>How a clinic plugs in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Implement the HTTP API from <code>task/clinic-api.md</code>. The
            adapter in <code>lib/clinic/http.ts</code> is path-compatible with
            Prosper, so any system that exposes the same JSON is a drop-in.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Catalogue: providers, sites, specialties, types, plans.</li>
            <li>Lookups: who is calling, what they may book, their diary.</li>
            <li>Writes are reports, not mutations — <code>POST /api/v1/submit/*</code>.</li>
            <li>Run the 73 public cases against that data before you put a voice model in front of it.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
