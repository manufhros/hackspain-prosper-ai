import { getClinicSource } from "@/lib/clinic/source";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ClinicPage() {
  const source = getClinicSource();
  let error: string | null = null;
  let catalog: Awaited<ReturnType<typeof source.clinic>> | null = null;
  try {
    catalog = await source.clinic();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load clinic";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl tracking-tight">Clinic data</h1>
        <p className="text-sm text-muted-foreground">
          Live catalogue from the connected source. Cache freely — this surface
          does not change during a call.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {catalog ? (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium">{catalog.clinic_name}</h2>
            <Badge variant="secondary">{source.info.kind}</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Providers", catalog.providers.length],
              ["Locations", catalog.locations.length],
              ["Specialties", catalog.specialties.length],
              ["Plans", catalog.plans.length],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-2xl">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          {catalog.restrictions?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Standing restrictions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {catalog.restrictions.map((row) => (
                  <div key={row.id}>
                    <span className="font-mono text-xs">{row.id}</span> · {row.title}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
