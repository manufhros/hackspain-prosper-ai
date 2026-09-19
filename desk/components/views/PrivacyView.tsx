import { ShieldCheck } from "lucide-react";
import { SettingsForm } from "@/components/SettingsForm";
import { Card, Grid2, KeyValues, Note, PageHeader } from "@/components/ui/primitives";
import { scopeCrumbs, scopeName, type ViewScope } from "./scope";

export function PrivacyView({ scope }: { scope: ViewScope }) {
  const key = scope.hospital?.id ?? scope.org.slug;
  return (
    <>
      <PageHeader
        crumbs={scopeCrumbs(scope, "Privacidad")}
        title="Privacidad y retención"
        description={`Qué conserva hash de cada llamada y durante cuánto tiempo. Se aplica a ${
          scope.kind === "org" ? `los ${scope.sites.length} centros de ${scopeName(scope)}` : scopeName(scope)
        }.`}
      />

      <Grid2>
        <SettingsForm org={key} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={16} aria-hidden="true" />
                Garantías fijadas por hash
              </span>
            }
            description="No dependen de la configuración del centro"
          >
            <KeyValues
              items={[
                ["Región de procesado", "Unión Europea"],
                ["Consejo médico", "Nunca"],
                ["Urgencias", "Escalado inmediato"],
                ["Datos del Art. 9 RGPD", "No se almacenan"],
              ]}
            />
          </Card>
          <Note>
            <strong>Se guarda en este navegador.</strong> Estos ajustes controlan lo que muestra el panel. No cambian el agente en
            producción: eso lo publica hash desde su consola.
          </Note>
        </div>
      </Grid2>
    </>
  );
}
