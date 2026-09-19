import { euro, num } from "@/lib/format";
import { hospitalScope } from "@/lib/scope";
import { pitch, SALES } from "@/lib/sales";

export default async function Ahorro({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { hospital, calls } = await hospitalScope(hid);
  const p = pitch(calls);

  return (
    <>
      <h1 className="hero">{euro(p.agendaYear + p.deskYear)}</h1>
      <p className="lede">
        {hospital.name}: agenda llena más centralita que no contratas. {SALES.days} jornadas.
      </p>
      <div className="stats">
        <div className="stat">
          <b>{euro(p.agendaYear)}</b>
          <span>Huecos cobrados</span>
        </div>
        <div className="stat">
          <b>{euro(p.deskYear)}</b>
          <span>Admisión no contratada</span>
        </div>
        <div className="stat">
          <b>{euro(p.missedYear)}</b>
          <span>Que no se escapa al buzón</span>
        </div>
        <div className="stat">
          <b>{p.booked} %</b>
          <span>Llamadas que acaban en cita</span>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Mostrador solo</th>
              <th>Con la línea</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Agenda al año</td>
              <td className="muted">{euro(p.agendaYear * (1 - SALES.missedWithout))}</td>
              <td>{euro(p.agendaYear)}</td>
            </tr>
            <tr>
              <td>Personal</td>
              <td className="muted">+{p.ftes.toFixed(1)} FTE</td>
              <td>0 extra</td>
            </tr>
            <tr>
              <td>Llamada perdida</td>
              <td className="muted">{Math.round(SALES.missedWithout * 100)} %</td>
              <td>{num(p.esc)} a persona</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
