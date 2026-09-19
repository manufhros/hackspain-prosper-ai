import { escapeHTML as esc, clinicalDate, duration } from "./model.js";

const number = (value) => new Intl.NumberFormat("es-ES").format(value ?? 0);
const metrics = [
  [
    "calls",
    "Llamadas recibidas",
    "Todas las llamadas entrantes",
    "phone-incoming",
  ],
  ["answered", "Atendidas", "Conectadas con Lucía", "phone-call"],
  [
    "forwarded",
    "Derivadas",
    "Con una derivación registrada",
    "arrow-bend-up-right",
  ],
  ["bookings", "Reservas", "Reservas registradas", "calendar-check"],
];
const states = [
  ["active", "En curso"],
  ["completed", "Finalizadas"],
  ["missed", "No atendidas"],
  ["failed", "Con error"],
  ["interrupted", "Interrumpidas"],
];
const actions = [
  ["cancellations", "Cancelaciones"],
  ["reschedules", "Cambios de cita"],
  ["registrations", "Altas de paciente"],
  ["noAction", "Sin gestión adicional"],
];

export function renderOverview(data, expanded = false) {
  const totals = data.totals;
  const max = Math.max(
    1,
    ...data.daily.flatMap((day) => [day.calls, day.bookings, day.forwarded]),
  );
  const column = 720 / Math.max(1, data.daily.length);
  const barWidth = Math.min(16, (column - 4) / 3);
  const chart = data.daily
    .map((day, i) =>
      ["calls", "bookings", "forwarded"]
        .map((kind, k) => {
          const height = (day[kind] / max) * 116;
          return `<rect class="chart-${kind}" x="${20 + i * column + (column - barWidth * 3) / 2 + k * barWidth}" y="${130 - height}" width="${barWidth - 1}" height="${height}" rx="2"><title>${esc(clinicalDate(day.day))} · ${number(day[kind])} ${kind === "calls" ? "llamadas" : kind === "bookings" ? "reservas" : "derivadas"}</title></rect>`;
        })
        .join(""),
    )
    .join("");
  return `<div class="overview-metrics">${metrics.map(([key, label, hint, icon]) => `<article class="metric"><div class="metric-label"><span>${label}</span><i class="ph ph-${icon}" aria-hidden="true"></i></div><strong>${number(totals[key])}</strong><p>${hint}</p></article>`).join("")}</div>
    ${totals.calls === 0 ? '<p class="overview-empty"><i class="ph ph-phone" aria-hidden="true"></i>Aún no hay llamadas en este periodo. Las métricas aparecerán al recibir la primera.</p>' : ""}
    <div class="overview-columns"><section class="overview-section overview-activity" aria-labelledby="activity-title"><div class="overview-section-heading"><h2 id="activity-title">El ritmo de tu recepción</h2><span>${data.period === "all" ? "Últimos 30 días" : "Actividad diaria"}</span></div>
      <div class="chart-legend"><span><i class="chart-calls"></i>Llamadas</span><span><i class="chart-bookings"></i>Reservas</span><span><i class="chart-forwarded"></i>Derivadas</span></div>
      <svg class="overview-chart" viewBox="0 0 760 150" role="img" aria-label="Actividad diaria: llamadas recibidas, reservas y llamadas derivadas. Los valores exactos están en el desglose por día."><path d="M20 14H740 M20 72H740 M20 130H740" class="chart-grid"/>${chart}</svg>
      <div class="chart-range"><span>${esc(clinicalDate(data.daily[0]?.day ?? data.to))}</span><span>${esc(clinicalDate(data.to))}</span></div>
      <details class="overview-breakdown" ${expanded ? "open" : ""}><summary>Ver desglose por día <i class="ph ph-caret-down" aria-hidden="true"></i></summary><div class="overview-table"><table><caption class="sr-only">Actividad diaria, según la fecha de inicio de cada llamada</caption><thead><tr><th scope="col">Día</th><th scope="col">Llamadas</th><th scope="col">Reservas</th><th scope="col">Derivadas</th></tr></thead><tbody>${data.daily.map((day) => `<tr><th scope="row">${esc(clinicalDate(day.day))}</th><td>${number(day.calls)}</td><td>${number(day.bookings)}</td><td>${number(day.forwarded)}</td></tr>`).join("")}</tbody></table></div></details>
    </section><section class="overview-section" aria-labelledby="outcomes-title"><h2 id="outcomes-title">Estado de las llamadas</h2><dl class="overview-stats">${states.map(([key, label]) => `<div><dt><span class="status-dot ${key}"></span>${label}</dt><dd>${number(totals[key])}</dd></div>`).join("")}</dl></section></div>
    <div class="overview-columns"><section class="overview-section"><h2>Gestiones registradas</h2><dl class="overview-stats">${actions.map(([key, label]) => `<div><dt>${label}</dt><dd>${number(totals[key])}</dd></div>`).join("")}</dl></section><section class="overview-section"><h2>Atención y herramientas</h2><dl class="overview-stats"><div><dt>Tasa de atención</dt><dd>${totals.calls ? `${number(Math.round((totals.answered / totals.calls) * 100))} %` : "—"}</dd></div><div><dt>Duración media <small>Llamadas conectadas y terminadas</small></dt><dd>${totals.durationSamples > 0 ? duration(0, totals.averageDurationMs) : "—"}</dd></div><div><dt>Herramientas ejecutadas</dt><dd>${number(totals.tools)}</dd></div><div><dt>Errores de herramientas</dt><dd>${number(totals.toolErrors)}</dd></div></dl></section></div>
    <footer class="overview-footnote">${data.persistent ? "Métricas conservadas entre reinicios." : "Datos temporales de esta sesión."} Periodo: ${esc(clinicalDate(data.from))} – ${esc(clinicalDate(data.to))}, Europe/Madrid. Las gestiones se agrupan por el inicio de la llamada. Una derivación registrada no confirma una transferencia telefónica. Las reservas cuentan acciones registradas, aunque después se cancelen; los registros repetidos se cuentan una sola vez por llamada.</footer>`;
}

export function createOverview(root, request) {
  const content = root.querySelector("#overview-content");
  const feedback = root.querySelector("#overview-feedback");
  const updated = root.querySelector("#overview-updated");
  const refresh = root.querySelector("#refresh-overview");
  let period = "30d";
  let controller;
  let timer;
  let demo = false;
  let hasData = false;
  let version = 0;

  async function load() {
    if (root.hidden || demo) return;
    const current = ++version;
    controller?.abort();
    controller = new AbortController();
    content.setAttribute("aria-busy", "true");
    refresh.disabled = true;
    if (!hasData)
      content.innerHTML =
        '<p class="overview-loading">Cargando el resumen…</p>';
    feedback.hidden = true;
    try {
      const result = await request(`/api/overview?period=${period}`, {
        signal: controller.signal,
      });
      if (current !== version) return;
      const expanded = content.querySelector("details")?.open;
      const focused =
        content.querySelector("summary") === document.activeElement;
      content.innerHTML = renderOverview(result, expanded);
      if (focused)
        content.querySelector("summary")?.focus({ preventScroll: true });
      hasData = true;
      updated.textContent = `Actualizado a las ${new Date(result.generatedAt).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })}`;
    } catch (error) {
      if (current !== version) return;
      feedback.hidden = false;
      feedback.textContent = `${hasData ? "Mostrando la última información recibida. " : ""}${error.message || "No se pudo cargar el resumen."} Usa Actualizar para volver a intentarlo.`;
      if (!hasData) content.innerHTML = "";
    } finally {
      if (current === version) {
        content.setAttribute("aria-busy", "false");
        refresh.disabled = false;
      }
    }
  }

  function setPeriod(next, navigate = false) {
    period = ["today", "7d", "30d", "all"].includes(next) ? next : "30d";
    for (const button of root.querySelectorAll("[data-period]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.period === period),
      );
    if (navigate) {
      const url = new URL(location.href);
      url.searchParams.set("period", period);
      history.replaceState({}, "", url);
    }
  }
  root.querySelector("#overview-periods").addEventListener("click", (event) => {
    const button = event.target.closest("[data-period]");
    if (!button || button.dataset.period === period) return;
    setPeriod(button.dataset.period, true);
    hasData = false;
    updated.textContent = "";
    void load();
  });
  refresh.addEventListener("click", () => void load());
  return {
    show(isDemo = false) {
      demo = isDemo;
      const previousPeriod = period;
      setPeriod(new URL(location.href).searchParams.get("period"));
      if (period !== previousPeriod) {
        hasData = false;
        updated.textContent = "";
      }
      if (demo) {
        ++version;
        controller?.abort();
        content.innerHTML =
          '<p class="overview-empty">Las llamadas de demostración no se guardan ni forman parte de las métricas. Selecciona «Volver al directo» para ver el resumen real.</p>';
        feedback.hidden = true;
        updated.textContent = "Demostración · Sin métricas reales";
        refresh.disabled = true;
        hasData = false;
        content.setAttribute("aria-busy", "false");
      } else void load();
    },
    hide() {
      ++version;
      controller?.abort();
      clearTimeout(timer);
      timer = undefined;
    },
    invalidate() {
      if (root.hidden || demo || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void load();
      }, 500);
    },
  };
}
