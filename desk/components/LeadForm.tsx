import { leadAction } from "@/app/lead-action";

export function LeadForm({ state }: { state?: "ok" | "bad" }) {
  if (state === "ok") {
    return (
      <p className="desk-ok" role="status">
        Recibido. Os llamamos esta misma semana.
      </p>
    );
  }

  return (
    <form className="login" action={leadAction}>
      <label>
        Nombre
        <input name="name" type="text" autoComplete="name" placeholder="Laura Martín" required />
      </label>
      <label>
        Cargo
        <select name="role" defaultValue="">
          <option value="" disabled>
            Selecciona tu cargo
          </option>
          <option value="direccion">Dirección</option>
          <option value="admision">Admisión</option>
          <option value="ti">TI</option>
          <option value="otro">Otro</option>
        </select>
      </label>
      <label>
        Centro
        <input name="center" type="text" placeholder="Hospital Central" required />
      </label>
      <label>
        Ciudad
        <input name="city" type="text" autoComplete="address-level2" placeholder="Murcia" />
      </label>
      <label>
        Teléfono
        <input name="phone" type="tel" autoComplete="tel" placeholder="+34 600 000 000" />
      </label>
      <label>
        Correo
        <input name="email" type="email" autoComplete="email" placeholder="laura@hospital.es" required />
      </label>
      <label>
        Llamadas al día
        <select name="volume" defaultValue="">
          <option value="" disabled>
            Selecciona un volumen
          </option>
          <option value="bajo">Menos de 20</option>
          <option value="medio">20 a 80</option>
          <option value="alto">Más de 80</option>
          <option value="red">Varias sedes</option>
        </select>
      </label>
      {state === "bad" ? (
        <p className="login-err">Nos faltan el nombre, el centro y un correo de contacto.</p>
      ) : null}
      <button type="submit">Que me llamen</button>
    </form>
  );
}
