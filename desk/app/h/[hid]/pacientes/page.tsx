import { euro, num } from "@/lib/format";
import { hospitalScope } from "@/lib/scope";
import { patientsFrom } from "@/lib/metrics";
import { pitch } from "@/lib/sales";

export default async function Pacientes({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  const { calls } = await hospitalScope(hid);
  const people = patientsFrom(calls).slice(0, 80);
  const p = pitch(calls);

  return (
    <>
      <h1>{num(p.altas)} altas</h1>
      <p className="lede">
        Primer año de esos pacientes: {euro(p.pipelineYear)}. No son recitas, son cartera nueva.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Mutua</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.name + p.last}>
                <td>{p.name}</td>
                <td>{p.insurer ?? "—"}</td>
                <td className="muted">{p.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
