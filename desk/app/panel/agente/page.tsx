import { AgentControl } from "@/components/AgentControl";
import { AgentFleet } from "@/components/AgentFleet";
import { DeveloperPortal } from "@/components/DeveloperPortal";
import { Badge, ButtonLink, PageHeader } from "@/components/ui/primitives";
import { canOpen, homeFor } from "@/lib/auth";
import { readAgentConfigState } from "@/lib/agent-config";
import { orgFaqCalls } from "@/lib/call-data";
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

  const query = await searchParams;
  const requested = query.org?.trim() ?? "";
  const orgSlug = isKnownOrganisation(requested) ? requested : ORGANISATIONS[0]!.slug;
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
        description={`Endpoints, prompt y FAQ de ${organisation.name}. El comportamiento publicado vale para toda la red.`}
        actions={
          <Badge tone={agentConfig.active ? "success" : "neutral"} dot>
            {agentConfig.active ? `Publicada · ${new Date(agentConfig.active.publishedAt).toLocaleDateString("es-ES")}` : "Sin publicar"}
          </Badge>
        }
      />
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
      <AgentFleet />
      <DeveloperPortal initialConfig={endpoints} suggestion={suggestFaqFromCalls(calls, endpoints.faq)} />
      <AgentControl initialState={agentConfig} />
    </>
  );
}
