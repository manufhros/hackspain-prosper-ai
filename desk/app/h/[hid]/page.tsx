import { euro, num } from "@/lib/format";
import { hospitalScope } from "@/lib/scope";
import { pitch } from "@/lib/sales";

export default async function Hoy({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { hospital, calls } = await hospitalScope(hid);
  const p = pitch(calls);

  return (
    <>
      <h1 className="hero">{euro(p.agendaYear)}</h1>
      <p className="lede">
        Agenda que este centro captura al año si sostiene el ritmo de hoy. {num(p.citas)} citas
        puestas · ticket medio 128 €.
      </p>
      <div className="stats">
        <div className="stat">
          <b>{euro(p.agendaYear)}</b>
          <span>Facturación de agenda</span>
        </div>
        <div className="stat">
          <b>{euro(p.pipelineYear)}</b>
          <span>Pacientes nuevos, año 1</span>
        </div>
        <div className="stat">
          <b>{p.kept} %</b>
          <span>Resuelto sin persona</span>
        </div>
        <div className="stat">
          <b>{p.ftes.toFixed(1)}</b>
          <span>Turnos de admisión que no abres</span>
        </div>
      </div>
      <div className="split">
        <div className="panel">
          <h2>Si cuelga el 19 %</h2>
          <p className="big">{euro(p.missedYear)}</p>
          <p className="muted">Citas que se pierde un mostrador que no da abasto. Esto lo evita la línea.</p>
        </div>
        <div className="panel">
          <h2>Hoy</h2>
          <table>
            <tbody>
              <tr>
                <td>Citas</td>
                <td>{num(p.citas)}</td>
              </tr>
              <tr>
                <td>Altas</td>
                <td>{num(p.altas)}</td>
              </tr>
              <tr>
                <td>Llamadas</td>
                <td>{num(p.calls)}</td>
              </tr>
              <tr>
                <td>A mostrador</td>
                <td>{num(p.esc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
