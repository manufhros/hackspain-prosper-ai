import { AgentControl } from "@/components/AgentControl";
import { AgentFleet } from "@/components/AgentFleet";
import { DeveloperPortal } from "@/components/DeveloperPortal";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { canOpen, homeFor } from "@/lib/auth";
import { readAgentConfigState } from "@/lib/agent-config";
import { CLINIC } from "@/lib/clinic";
import { readOrgAgentConfig } from "@/lib/org-agent-config";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { checkOrgEndpoints } from "./actions";

export const dynamic = "force-dynamic";

export default async function Agente() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/agente")) redirect(homeFor(session));

  const agentConfig = await readAgentConfigState();
  let endpoints = await readOrgAgentConfig(CLINIC.slug);
  try {
    endpoints = (await checkOrgEndpoints(CLINIC.slug)).config;
  } catch {
    /* keep the last known health state if Prosper is temporarily unreachable */
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Consola hash", href: "/panel" }, { label: "Configuración del agente" }]}
        title="Configuración del agente"
        description="Voz, comportamiento, preguntas frecuentes y endpoints del hospital. Publicar aplica los cambios en el runtime; guardar solo deja un borrador."
        actions={
          <Badge tone={agentConfig.active ? "success" : "neutral"} dot>
            {agentConfig.active ? `Publicada · ${new Date(agentConfig.active.publishedAt).toLocaleDateString("es-ES")}` : "Sin publicar"}
          </Badge>
        }
      />
      <AgentFleet />
      <AgentControl initialState={agentConfig} />
      <DeveloperPortal initialConfig={endpoints} />
    </>
  );
}
