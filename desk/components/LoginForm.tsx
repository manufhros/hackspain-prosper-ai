import { loginAction } from "@/app/login-action";
import { ACCOUNTS } from "@/lib/auth";

export function LoginForm({ failed, autofocus }: { failed?: boolean; autofocus?: boolean }) {
  return (
    <form className="login" action={loginAction}>
      <label>
        Correo
        <input
          type="email"
          name="email"
          autoComplete="username"
          autoFocus={autofocus}
          placeholder="nombre@clinica.es"
        />
      </label>
      {failed ? <p className="login-err">Ese correo no está dado de alta.</p> : null}
      <button type="submit">Entrar</button>

      <div className="login-accounts" aria-label="Cuentas de la demo">
        <span>O entra directamente como</span>
        {ACCOUNTS.map((account) => (
          <button key={account.email} type="submit" name="account" value={account.email} className="login-account">
            <strong>{account.label}</strong>
            <small>
              {account.note} · {account.email}
            </small>
          </button>
        ))}
      </div>
    </form>
  );
}
