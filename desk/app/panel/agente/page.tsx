import { AgentControl } from "@/components/AgentControl";
import { AgentFleet } from "@/components/AgentFleet";
import { DeveloperPortal } from "@/components/DeveloperPortal";
import { Badge, ButtonLink, PageHeader } from "@/components/ui/primitives";
import { canOpen, homeFor } from "@/lib/auth";
import { readAgentConfigState } from "@/lib/agent-config";
import { orgFaqCalls } from "@/lib/call-data";
import { CLINIC } from "@/lib/clinic";
import { suggestFaqFromCalls } from "@/lib/faq-suggestion";
import { isKnownOrganisation, ORGANISATIONS } from "@/lib/orgs";
import { readOrgAgentConfig } from "@/lib/org-agent-config";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { checkOrgEndpoints } from "./actions";

export const dynamic = "force-dynamic";

export default async function Agente({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/agente")) redirect(homeFor(session));

  const clinicOnly = session.role !== "admin";
  const query = await searchParams;
  const requested = query.org?.trim() ?? "";
  const orgSlug = clinicOnly
    ? CLINIC.slug
    : isKnownOrganisation(requested) ? requested : ORGANISATIONS[0]!.slug;
  const organisation = ORGANISATIONS.find((item) => item.slug === orgSlug)!;

  const [agentConfig, calls] = await Promise.all([
    readAgentConfigState(),
    orgFaqCalls(orgSlug),
  ]);
  let endpoints = await readOrgAgentConfig(orgSlug);
  try {
    endpoints = (await checkOrgEndpoints(orgSlug)).config;
  } catch {
    /* keep the last known health state if Prosper is temporarily unreachable */
  }
  endpoints = {
    ...endpoints,
    voiceId: agentConfig.active?.config.voiceId ?? agentConfig.draft.voiceId,
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Resumen", href: "/panel" }, { label: organisation.name }, { label: "Configuración" }]}
        title="Configuración del agente"
        description={clinicOnly
          ? `Saludo, reglas, FAQ y API de ${organisation.name}. Vale para las próximas llamadas de este centro.`
          : `API de la clínica, prompt y FAQ de ${organisation.name}. El comportamiento publicado vale para toda la red.`}
        actions={clinicOnly ? undefined : (
          <Badge tone={agentConfig.active ? "success" : "neutral"} dot>
            {agentConfig.active ? `Publicada · ${new Date(agentConfig.active.publishedAt).toLocaleDateString("es-ES")}` : "Sin publicar"}
          </Badge>
        )}
      />
      {clinicOnly ? null : (
        <nav aria-label="Hospital" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ORGANISATIONS.map((item) => (
            <ButtonLink
              key={item.slug}
              href={`/panel/agente?org=${item.slug}`}
              current={item.slug === orgSlug}
              size="sm"
              variant={item.slug === orgSlug ? "primary" : "secondary"}
            >
              {item.name}
            </ButtonLink>
          ))}
        </nav>
      )}
      {clinicOnly ? null : <AgentFleet />}
      <DeveloperPortal
        initialConfig={endpoints}
        suggestion={suggestFaqFromCalls(calls, endpoints.faq)}
        variant={clinicOnly ? "clinic" : "admin"}
        moreHref={clinicOnly ? "/panel/agente/monitor" : `/panel/agente/monitor?org=${orgSlug}`}
      />
      {clinicOnly ? null : <AgentControl initialState={agentConfig} />}
    </>
  );
}
