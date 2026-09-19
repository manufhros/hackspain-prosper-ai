export function euro(n: number, digits = 0): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function num(n: number): string {
  return new Intl.NumberFormat("es-ES").format(Math.round(n));
}

export function hours(minutes: number): string {
  const h = minutes / 60;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(h)} h`;
}
