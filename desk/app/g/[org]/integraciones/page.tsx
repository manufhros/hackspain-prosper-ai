import { DeveloperPortal } from "@/components/DeveloperPortal";
import { getSession } from "@/lib/session";
import { readOrgAgentConfig } from "@/lib/org-agent-config";
import { redirect } from "next/navigation";
import styles from "./page.module.css";
import { checkOrgEndpoints } from "./actions";

export default async function Integraciones({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const session = await getSession();
  if (session?.kind !== "org" || session.orgSlug !== org || session.role !== "dev") redirect("/");
  let config = await readOrgAgentConfig(org);
  try {
    config = (await checkOrgEndpoints(org)).config;
  } catch {
    // Keep the last known health state if Prosper is temporarily unreachable.
  }
  return (
    <div className={styles.page}>
      <header><p>Portal técnico</p><h1>Conecta vuestro hospital</h1><span>Solo endpoints. La voz, las FAQ y el comportamiento del agente los publica hash.</span></header>
      <DeveloperPortal initialConfig={config} />
    </div>
  );
}
