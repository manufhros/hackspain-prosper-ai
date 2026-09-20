"use client";

import { checkOrgEndpoints, saveOrgIntegrationConfig } from "@/app/panel/agente/actions";
import { PeakChart } from "@/components/PeakChart";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import type { EndpointHealth, OrgAgentConfig } from "@/lib/org-agent-config";
import { hooksFromRoutes, PROSPER_ENDPOINTS } from "@/lib/prosper-endpoints";
import type { PeakPoint } from "@/lib/reporting";
import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import styles from "../DeveloperPortal.module.css";

const HEALTH_LABEL = {
  healthy: "Healthy",
  unknown: "Sin comprobar",
  degraded: "Degraded",
  down: "Down",
} as const;

const EMPTY_HEALTH: EndpointHealth = {
  status: "unknown",
  checkedAt: null,
  latencyMs: null,
  statusCode: null,
  message: null,
};

export function EndpointMonitor({
  organisation,
  timeline,
  backHref,
  initialConfig,
}: {
  organisation: string;
  timeline: PeakPoint[];
  backHref: string;
  initialConfig: OrgAgentConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function patchRoute(path: string, url: string) {
    setConfig((current) => {
      const routes = { ...current.routes, [path]: url };
      return { ...current, routes, ...hooksFromRoutes(routes) };
    });
    setNotice(null);
  }

  function run(action: () => Promise<{ message: string; config: OrgAgentConfig }>) {
    startTransition(async () => {
      try {
        const result = await action();
        setConfig(result.config);
        setNotice(result.message);
        setEditingPath(null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "No se pudo guardar.");
      }
    });
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Resumen", href: "/panel" },
          { label: organisation },
          { label: "Agente", href: backHref },
          { label: "Endpoints" },
        ]}
        title="Endpoints"
      />
      <Card title="Picos de llamadas" description="Volumen por hora, últimos 7 días.">
        <PeakChart points={timeline} />
      </Card>
      <section className={styles.portal}>
        <section className={styles.endpoints}>
          <header>
            <div>
              <p>Conectividad</p>
              <h2>Endpoints del hospital</h2>
            </div>
            <button disabled={pending} type="button" onClick={() => run(() => checkOrgEndpoints(config.orgSlug))}>
              Comprobar salud
            </button>
          </header>
          {PROSPER_ENDPOINTS.map((item) => {
            const editing = editingPath === item.path;
            const value = config.routes[item.path] ?? item.url;
            const health = config.routeHealth?.[item.path] ?? config.health.preCall ?? EMPTY_HEALTH;
            return (
              <article className={styles.hookRow} key={item.path}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.method} · {item.copy}</small>
                </span>
                <input
                  type="url"
                  value={value}
                  readOnly={!editing}
                  autoFocus={editing}
                  onChange={(event) => patchRoute(item.path, event.target.value)}
                />
                <div className={styles.endpointState}>
                  <em data-status={health.status}>
                    {HEALTH_LABEL[health.status]}
                    {health.latencyMs ? ` · ${health.latencyMs} ms` : ""}
                  </em>
                  <button
                    type="button"
                    className={editing ? styles.editing : styles.edit}
                    aria-label={editing ? `Terminar edición de ${item.label}` : `Editar ${item.label}`}
                    onClick={() => setEditingPath((current) => (current === item.path ? null : item.path))}
                  >
                    <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
        <footer>
          <span>{notice ?? "Los cambios de URL valen para las próximas llamadas."}</span>
          <Button disabled={pending} onClick={() => run(() => saveOrgIntegrationConfig(config))}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </footer>
      </section>
    </>
  );
}
