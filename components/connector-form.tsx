"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Probe = {
  ok: boolean;
  error?: string;
  clinic_name?: string;
  patient_count?: number;
  providers?: number;
  locations?: number;
  specialties?: number;
};

export function ConnectorForm() {
  const [baseUrl, setBaseUrl] = useState("https://hackspain.getprosperapp.com");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);

  async function onTest() {
    setBusy(true);
    try {
      const response = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      const data = (await response.json()) as Probe;
      setProbe(data);
      if (data.ok) toast.success(`Connected to ${data.clinic_name ?? "clinic"}`);
      else toast.error(data.error ?? "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Connect a clinic API</CardTitle>
          <CardDescription>
            Any EHR or ERP that speaks the clinic contract: the same{" "}
            <code>/api/v1/clinic</code>, <code>/directory</code>,{" "}
            <code>/availability</code> and <code>/patients/{"{id}"}/appointments</code>{" "}
            routes documented for Clínica Arenal. Persist the key in{" "}
            <code>.env</code> as <code>CLINIC_API_BASE_URL</code> and{" "}
            <code>CLINIC_API_KEY</code>. This form only probes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://clinic.example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API key header value</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sent as X-Api-Key"
            />
          </div>
          <Button nativeButton onClick={onTest} disabled={busy || !baseUrl || !apiKey}>
            {busy ? "Testing…" : "Test connection"}
          </Button>
        </CardContent>
      </Card>
      {probe ? (
        <Alert variant={probe.ok ? "default" : "destructive"}>
          <AlertTitle>{probe.ok ? "Reachable" : "Failed"}</AlertTitle>
          <AlertDescription>
            {probe.ok
              ? `${probe.clinic_name} · ${probe.patient_count ?? "?"} patients · ${probe.providers} providers · ${probe.locations} sites · ${probe.specialties} specialties`
              : probe.error}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
