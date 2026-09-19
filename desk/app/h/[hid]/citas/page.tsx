import { Motive } from "@/components/Motive";
import { euro, num } from "@/lib/format";
import { hospitalScope } from "@/lib/scope";
import { pitch } from "@/lib/sales";

export default async function Citas({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { hospital, org, calls } = await hospitalScope(hid);
  const rows = calls.filter((c) => c.outcome === "cita").slice(0, 80);
  const p = pitch(calls);

  return (
    <>
      <h1>Citas</h1>
      <p className="lede">
        {num(p.citas)} huecos · {euro(p.agendaDay)} hoy · {euro(p.agendaYear)} al año
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Paciente</th>
              <th>Motivo</th>
              <th>Hueco</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.patient ?? <span className="muted">—</span>}</td>
                <td>
                  <Motive org={hospital.id} text={row.motive} live={org.source === "llamadas"} />
                </td>
                <td>{row.slot?.replace("T", " ").slice(0, 16) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
