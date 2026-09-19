export function BrandBar({ compact }: { compact?: boolean }) {
  return (
    <header className="brandbar">
      <a className="brand" href="/">
        hash
      </a>
      {compact ? (
        <a className="brandbar-link" href="/">
          Volver
        </a>
      ) : (
        <nav className="brandbar-nav">
          <a href="/entrar">Entrar</a>
        </nav>
      )}
    </header>
  );
}
