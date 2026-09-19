import { euro, num } from "@/lib/format";
import { orgScope } from "@/lib/org-scope";
import { patientsFrom } from "@/lib/metrics";
import { pitch } from "@/lib/sales";

export default async function Pacientes({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { calls } = await orgScope(slug);
  const people = patientsFrom(calls).slice(0, 80);
  const p = pitch(calls);
  return (
    <>
      <h1>{num(p.altas)} altas</h1>
      <p className="lede">Primer año: {euro(p.pipelineYear)}</p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Mutua</th>
            </tr>
          </thead>
          <tbody>
            {people.map((row) => (
              <tr key={row.name + row.last}>
                <td>{row.name}</td>
                <td>{row.insurer ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
