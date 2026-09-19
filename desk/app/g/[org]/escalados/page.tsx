import { Motive } from "@/components/Motive";
import { orgScope } from "@/lib/org-scope";
import { OUTCOME_LABEL } from "@/lib/metrics";
import { pitch } from "@/lib/sales";

export default async function Escalados({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, calls } = await orgScope(slug);
  const rows = calls.filter((c) => c.outcome === "escalado" || c.outcome === "sin_cita");
  const p = pitch(calls);
  return (
    <>
      <h1>{p.kept} % no pasa a mostrador</h1>
      <p className="lede">{org.name}</p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Centro</th>
              <th>Tipo</th>
              <th>Llamada</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.siteName}</td>
                <td>{OUTCOME_LABEL[row.outcome] ?? row.outcome}</td>
                <td>
                  <Motive org={org.slug} text={row.motive} live={org.source === "llamadas"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
