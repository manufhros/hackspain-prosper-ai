import { Motive } from "@/components/Motive";
import { euro, num } from "@/lib/format";
import { orgScope } from "@/lib/org-scope";
import { pitch } from "@/lib/sales";

export default async function Citas({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, calls } = await orgScope(slug);
  const rows = calls.filter((c) => c.outcome === "cita").slice(0, 80);
  const p = pitch(calls);
  return (
    <>
      <h1>Citas</h1>
      <p className="lede">
        {num(p.citas)} huecos · {euro(p.agendaYear)} al año
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Centro</th>
              <th>Paciente</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.siteName}</td>
                <td>{row.patient ?? <span className="muted">—</span>}</td>
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
