import { loginAction } from "@/app/login-action";

export function LoginForm({
  failed,
  autofocus,
  from,
}: {
  failed?: boolean;
  autofocus?: boolean;
  from?: string;
}) {
  return (
    <form className="login" action={loginAction}>
      {from ? <input type="hidden" name="from" value={from} /> : null}
      <label>
        Correo del centro
        <input
          type="email"
          name="email"
          autoComplete="username"
          autoFocus={autofocus}
          required
          placeholder="nombre@hospital.es"
        />
      </label>
      {failed ? <p className="login-err">Ese correo no está dado de alta.</p> : null}
      <button type="submit">Entrar</button>
    </form>
  );
}
