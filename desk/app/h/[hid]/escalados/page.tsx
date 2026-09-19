import { Motive } from "@/components/Motive";
import { hospitalScope } from "@/lib/scope";
import { OUTCOME_LABEL } from "@/lib/metrics";
import { pitch } from "@/lib/sales";

export default async function Escalados({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { hospital, org, calls } = await hospitalScope(hid);
  const rows = calls.filter((c) => c.outcome === "escalado" || c.outcome === "sin_cita");
  const p = pitch(calls);

  return (
    <>
      <h1>{p.kept} % no pasa a mostrador</h1>
      <p className="lede">
        {p.esc} sí. El resto lo cierra la línea. Eso es personal que no sales a cubrir.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Código</th>
              <th>Llamada</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{OUTCOME_LABEL[row.outcome] ?? row.outcome}</td>
                <td>{row.reason ?? "—"}</td>
                <td>
                  <Motive org={hospital.id} text={row.motive} live={org.source === "llamadas"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
