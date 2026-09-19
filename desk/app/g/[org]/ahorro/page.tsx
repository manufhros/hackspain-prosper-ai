import { euro, num } from "@/lib/format";
import { orgScope } from "@/lib/org-scope";
import { pitch, SALES } from "@/lib/sales";

export default async function Ahorro({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, calls } = await orgScope(slug);
  const p = pitch(calls);
  return (
    <>
      <h1 className="hero">{euro(p.agendaYear + p.deskYear)}</h1>
      <p className="lede">
        {org.name}. {SALES.days} jornadas. Solo vuestro grupo.
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
          <span>Llamadas a cita</span>
        </div>
      </div>
    </>
  );
}
