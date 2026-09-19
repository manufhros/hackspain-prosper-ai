import { ConnectorForm } from "@/components/connector-form";
import { getClinicSource } from "@/lib/clinic/source";

export default async function ConnectorsPage() {
  const source = getClinicSource();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl tracking-tight">Connector</h1>
        <p className="text-sm text-muted-foreground">
          Active source: {source.info.name} ({source.info.kind}
          {source.info.baseUrl ? ` · ${source.info.baseUrl}` : ""}). Without{" "}
          <code>CLINIC_API_KEY</code> the app uses a fixture built from the
          public cases so Run All works offline.
        </p>
      </div>
      <ConnectorForm />
    </div>
  );
}
