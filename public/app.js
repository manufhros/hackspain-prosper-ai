import {
  STATUS,
  TOOL_NAMES,
  time,
  dayKey,
  dayLabel,
  duration,
  filterCalls,
  escapeHTML as esc,
  summary,
} from "./model.js";
import { createDemo, demoAvailability } from "./demo.js";
import { presentTool } from "./tool-presentation.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const preferences = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`lucia-${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`lucia-${key}`, value);
    } catch {
      /* Preferences still work for this tab. */
    }
  },
};
let calls = [];
let selectedId;
let currentCall;
let events;
let detailRequest;
let settingsRequest;
let demo = false;
let demoCalls = [];
let demoTimer;
let demoStage = 0;
let connection = "connecting";
let storageError = false;
let theme = preferences.get("theme", "system");
let follow = preferences.get("auto-follow", "true") !== "false";
let reduced = preferences.get("reduce-motion", "false") === "true";
let providerInitial = "";
let providerBusy = false;
let settingsLoaded = false;
let lastMessageIds = new Set();
let lastToolsSignature = "";
let requestVersion = 0;
let latestDetailRevision = -1;
const openTools = new Map();
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const systemMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motion = () => (reduced || systemMotion.matches ? "instant" : "smooth");

function announce(message) {
  $("#announcement").textContent = message;
}
function statusMarkup(status) {
  const item = STATUS[status] || STATUS.interrupted;
  return `<span class="call-status ${item.className}">${status === "active" ? '<span class="status-dot"></span>' : icon(item.icon)}${item.label}</span>`;
}
function applyTheme(choice) {
  theme = ["light", "dark", "system"].includes(choice) ? choice : "system";
  preferences.set("theme", theme);
  const resolved =
    theme === "system" ? (systemTheme.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  $("#theme-toggle").innerHTML = icon(resolved === "dark" ? "sun" : "moon");
  $("#theme-toggle").setAttribute(
    "aria-label",
    `Cambiar a modo ${resolved === "dark" ? "claro" : "oscuro"}`,
  );
  $$("[data-theme-choice]").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === theme),
    ),
  );
}
applyTheme(theme);
systemTheme.addEventListener("change", () => {
  if (theme === "system") applyTheme("system");
});
$("#theme-toggle").addEventListener("click", () =>
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  ),
);
$$("[data-theme-choice]").forEach((button) =>
  button.addEventListener("click", () =>
    applyTheme(button.dataset.themeChoice),
  ),
);
$("#auto-follow").checked = follow;
$("#auto-follow").addEventListener("change", (event) => {
  follow = event.target.checked;
  preferences.set("auto-follow", String(follow));
  updateFollow();
});
$("#reduce-motion").checked = reduced;
$("#reduce-motion").addEventListener("change", (event) => {
  reduced = event.target.checked;
  document.documentElement.dataset.reducedMotion = String(reduced);
  preferences.set("reduce-motion", String(reduced));
});

function updateDate() {
  $("#today").textContent = new Date().toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  $("#today").dateTime = new Date().toISOString();
}
updateDate();

async function api(path, options = {}) {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.method === "POST" ? 40_000 : 15_000),
      ])
    : AbortSignal.timeout(options.method === "POST" ? 40_000 : 15_000);
  const response = await fetch(path, {
    ...options,
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Lucia-Console": "1",
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "No se pudo completar la solicitud.");
  return result;
}

function showConnection() {
  const badge = $("#connection");
  const banner = $("#connection-banner");
  const labels = {
    connecting: "Conectando",
    connected: "Conectado",
    disconnected: "Reconectando",
  };
  badge.className = `connection ${demo ? "demo" : connection === "disconnected" ? "offline" : ""}`;
  badge.innerHTML = `<span class="status-dot"></span>${demo ? "Demostración" : labels[connection]}`;
  $("#exit-demo").hidden = !demo;
  const disconnected = !demo && connection === "disconnected";
  banner.hidden = !disconnected && !storageError;
  banner.textContent = disconnected
    ? "Se ha perdido la conexión. Mostramos la última información recibida; volveremos a conectar automáticamente."
    : storageError
      ? "No se ha podido guardar o recuperar el historial. Las llamadas actuales siguen visibles; revisa los permisos de data/calls.json."
      : "";
  $("#live-indicator").hidden =
    demo || connection !== "connected" || currentCall?.status !== "active";
  updateFollow();
}

function connect() {
  events?.close();
  connection = "connecting";
  showConnection();
  events = new EventSource("/api/events");
  events.onopen = () => {
    connection = "connected";
    showConnection();
  };
  events.onerror = () => {
    connection = "disconnected";
    showConnection();
  };
  events.addEventListener("snapshot", (event) => {
    const snapshot = JSON.parse(event.data);
    calls = snapshot.calls;
    storageError = snapshot.storageError;
    renderHistory();
    showConnection();
    const requested = new URL(location.href).searchParams.get("call");
    const id =
      calls.find((call) => call.id === (selectedId || requested))?.id ||
      calls[0]?.id;
    if (id) selectCall(id, false);
    else {
      selectedId = undefined;
      currentCall = undefined;
      renderEmpty();
    }
  });
  events.addEventListener("call", (event) => {
    const call = JSON.parse(event.data);
    calls = [call, ...calls.filter((item) => item.id !== call.id)].sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    if (calls.length > 200)
      calls = calls.filter(
        (item, index) => index < 200 || item.status === "active",
      );
    renderHistory();
    if (!selectedId) selectCall(call.id, false);
    else if (selectedId === call.id && call.revision > latestDetailRevision)
      void loadDetail(call.id);
  });
  events.addEventListener("heartbeat", (event) => {
    storageError = JSON.parse(event.data).storageError;
    showConnection();
  });
}

function renderHistory() {
  const list = $("#call-list");
  const focusedId = list.contains(document.activeElement)
    ? document.activeElement.dataset.call
    : undefined;
  const scroll = list.scrollTop;
  const query = $("#call-search").value;
  const items = filterCalls(calls, query);
  $("#call-count").textContent = calls.length;
  $("#clear-search").hidden = !query;
  $(".search-shortcut").hidden = Boolean(query);
  if (!items.length) {
    list.innerHTML = `<div class="list-message">${query ? "No hay llamadas que coincidan." : connection === "connecting" && !demo ? "Conectando con el historial…" : "Todavía no hay llamadas."}${query ? '<br><button class="button quiet compact" data-action="clear">Borrar búsqueda</button>' : ""}</div>`;
    return;
  }
  let group = "";
  list.innerHTML = items
    .map((call) => {
      const key = dayKey(call.startedAt);
      const title =
        key !== group
          ? `<h2 class="date-group">${esc(dayLabel(call.startedAt))}<span class="sr-only"> · ${esc(key)}</span></h2>`
          : "";
      group = key;
      return `${title}<button class="call-row" data-call="${esc(call.id)}" aria-current="${call.id === selectedId}" aria-label="${esc(call.name)}, ${esc(STATUS[call.status]?.label)}, ${esc(time(call.startedAt))}"><span class="phone-avatar">${icon(call.status === "missed" ? "phone-x" : "phone")}</span><span class="row-content"><span class="row-top"><strong>${esc(call.name)}</strong><time datetime="${esc(call.startedAt)}">${time(call.startedAt)}</time></span><span class="row-bottom">${statusMarkup(call.status)}<span class="row-duration" data-duration="${esc(call.id)}">${duration(call.startedAt, call.endedAt)}</span></span></span></button>`;
    })
    .join("");
  list.scrollTop = scroll;
  if (focusedId)
    [...list.querySelectorAll("[data-call]")]
      .find((button) => button.dataset.call === focusedId)
      ?.focus({ preventScroll: true });
}
$("#call-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-call]");
  if (button) selectCall(button.dataset.call, true);
  if (event.target.closest('[data-action="clear"]')) clearSearch();
});
$("#call-search").addEventListener("input", (event) => {
  if (!event.isComposing) renderHistory();
});
$("#call-search").addEventListener("compositionend", renderHistory);
function clearSearch() {
  $("#call-search").value = "";
  renderHistory();
  $("#call-search").focus();
}
$("#clear-search").addEventListener("click", clearSearch);

async function selectCall(id, navigate = true) {
  const changed = selectedId !== id;
  selectedId = id;
  if (changed) {
    currentCall = undefined;
    latestDetailRevision = -1;
    lastMessageIds.clear();
    lastToolsSignature = "";
    $("#transcript").scrollTop = 0;
  }
  const url = new URL(location.href);
  url.searchParams.set("call", id);
  if (navigate) history.pushState({}, "", url);
  else history.replaceState({}, "", url);
  renderHistory();
  $("#workspace").dataset.mobileView = "conversation";
  if (demo) {
    currentCall = demoCalls.find((call) => call.id === id);
    renderDetail(changed);
  } else {
    if (changed) {
      const item = calls.find((call) => call.id === id);
      $("#conversation-title").textContent = item?.name || "Cargando…";
      $("#call-meta").innerHTML = item ? statusMarkup(item.status) : "";
      $("#transcript").innerHTML =
        '<div class="list-message">Cargando la conversación…</div>';
      $("#tool-list").innerHTML =
        '<div class="list-message">Cargando herramientas…</div>';
    }
    await loadDetail(id, changed);
  }
  if (navigate && matchMedia("(max-width:660px)").matches)
    $("#conversation-title").focus({ preventScroll: true });
}
async function loadDetail(id, first = false) {
  const version = ++requestVersion;
  detailRequest?.abort();
  detailRequest = new AbortController();
  try {
    const call = await api(`/api/calls/${encodeURIComponent(id)}`, {
      signal: detailRequest.signal,
    });
    if (selectedId !== id || demo || version !== requestVersion) return;
    currentCall = call;
    latestDetailRevision = call.revision;
    renderDetail(first);
  } catch (error) {
    if (
      error.name === "AbortError" ||
      selectedId !== id ||
      demo ||
      version !== requestVersion
    )
      return;
    if (!currentCall) {
      $("#transcript").innerHTML =
        `<div class="empty-state"><h3>No pudimos abrir esta llamada.</h3><p>${esc(error.message)}</p><button class="button secondary" data-action="retry">Volver a intentar</button></div>`;
      $("#tool-list").innerHTML =
        '<div class="tools-empty"><p>Las herramientas se mostrarán cuando se recupere la llamada.</p></div>';
    } else {
      $("#transcript-caption").textContent =
        "No se pudo actualizar. Mostrando la última transcripción recibida.";
    }
  }
}

function renderDetail(first = false) {
  const call = currentCall;
  if (!call) return;
  const transcript = $("#transcript");
  const atBottom =
    transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <
    70;
  const previousScroll = transcript.scrollTop;
  $("#conversation-title").textContent = call.name;
  document.title = `${call.name} · Lucía`;
  $("#call-meta").innerHTML =
    `${statusMarkup(call.status)}<span class="meta-separator"></span><time id="selected-duration">${duration(call.startedAt, call.endedAt)}</time><span class="meta-separator"></span><span>${esc(time(call.startedAt))}</span>`;
  $("#transcript-caption").textContent = demo
    ? "Una conversación simulada para explorar tu consola."
    : call.status === "active"
      ? "Los mensajes aparecen a medida que llegan."
      : `Llamada del ${new Date(call.startedAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long" })}.`;
  $("#jump-latest").disabled = !call.transcript.length;
  const oldNodes = new Map(
    [...transcript.querySelectorAll(".message")].map((node) => [
      node.dataset.message,
      node,
    ]),
  );
  const fragment = document.createDocumentFragment();
  if (call.error) {
    const error = document.createElement("div");
    error.className = "call-error";
    error.textContent = call.error;
    fragment.append(error);
  }
  if (!call.transcript.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<img src="/assets/lucia-orb.png" alt="" width="80" height="80"><h3>${call.status === "active" ? "Escuchando el primer saludo." : "Sin transcripción."}</h3><p>${call.status === "active" ? "La conversación aparecerá aquí cuando el proveedor envíe el primer mensaje." : call.status === "missed" ? "Esta llamada terminó antes de conectar con Lucía." : "No se recibieron mensajes para esta llamada."}</p>`;
    fragment.append(empty);
  }
  for (const message of call.transcript) {
    let node = oldNodes.get(message.id);
    if (!node) {
      node = document.createElement("article");
      node.className = "message";
      node.dataset.message = message.id;
    }
    node.classList.toggle("existing-message", oldNodes.has(message.id));
    node.classList.toggle("message-agent", message.role === "agent");
    node.classList.toggle("message-patient", message.role !== "agent");
    const signature = `${message.text}|${message.corrected}`;
    if (node.dataset.signature !== signature) {
      node.dataset.signature = signature;
      node.innerHTML = `<span class="speaker-avatar ${message.role === "agent" ? "agent" : ""}" aria-hidden="true">${message.role === "agent" ? '<img src="/assets/lucia-orb.png" alt="" width="36" height="36">' : esc(call.name[0] || "P")}</span><div class="message-body"><div class="message-heading"><strong>${message.role === "agent" ? "Lucía" : esc(call.name.split(" ")[0])}</strong><time datetime="${esc(message.at)}">${time(message.at)}</time></div><p>${esc(message.text)}</p>${message.corrected ? `<span class="corrected-note">${icon("arrow-counter-clockwise")}Ajustado tras una interrupción</span>` : ""}</div>`;
    }
    fragment.append(node);
  }
  transcript.replaceChildren(fragment);
  if (first) transcript.scrollTop = transcript.scrollHeight;
  else if (follow && atBottom)
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: motion() });
  else transcript.scrollTop = previousScroll;
  const freshMessages = call.transcript.filter(
    (message) => !lastMessageIds.has(message.id),
  );
  if (!first && freshMessages.length)
    announce(
      `${freshMessages.length} ${freshMessages.length === 1 ? "mensaje nuevo" : "mensajes nuevos"} en la llamada de ${call.name}.`,
    );
  lastMessageIds = new Set(call.transcript.map((message) => message.id));
  renderTools();
  showConnection();
  updateFollow();
}
function renderTools() {
  const call = currentCall;
  if (!call) return;
  const signature = `${call.id}:${JSON.stringify(call.tools)}`;
  if (signature === lastToolsSignature) return;
  lastToolsSignature = signature;
  const panel = $("#tool-list");
  const scroll = panel.scrollTop;
  const atBottom = panel.scrollHeight - panel.clientHeight - scroll < 50;
  const focusedTool = panel.contains(document.activeElement)
    ? document.activeElement.closest("[data-disclosure]")?.dataset.disclosure
    : undefined;
  $("#tool-count").textContent = call.tools.length;
  if (!call.tools.length) {
    panel.innerHTML = `<div class="tools-empty">${icon("path")}<h3>Todo tiene su porqué.</h3><p>${call.status === "active" ? "Las consultas de Lucía aparecerán aquí mientras avanza la conversación." : "No se ejecutaron herramientas en esta llamada."}</p></div>`;
    return;
  }
  panel.innerHTML = call.tools
    .map((tool) => {
      const [name, glyph] = TOOL_NAMES[tool.name] || [tool.name, "code-block"];
      const info = {
        running: ["En ejecución", "spinner-gap"],
        completed: ["Completada", "check"],
        failed: ["Error", "x"],
        interrupted: ["Interrumpida", "pause"],
      }[tool.status];
      const presentation = presentTool(tool, call.tools);
      const key = `${call.id}:${tool.id}`;
      const isOpen = openTools.has(key)
        ? openTools.get(key)
        : tool.status === "running" || tool.status === "failed";
      const elapsed =
        tool.durationMs === undefined
          ? tool.status === "running"
            ? `${((Date.now() - Date.parse(tool.startedAt)) / 1000).toFixed(1).replace(".", ",")} s`
            : "Sin resultado"
          : tool.durationMs < 1000
            ? `${tool.durationMs} ms`
            : `${(tool.durationMs / 1000).toFixed(1).replace(".", ",")} s`;
      return `<article class="tool-item"><span class="tool-node ${tool.status}">${icon(info[1])}</span><time class="tool-time" datetime="${esc(tool.startedAt)}">${time(tool.startedAt, true)}</time><details data-tool="${esc(tool.id)}" data-disclosure="${esc(tool.id)}" ${isOpen ? "open" : ""}><summary><span class="tool-icon">${icon(glyph)}</span><span class="tool-title"><strong>${esc(name)}</strong><span class="tool-preview">${esc(presentation.summary)}</span><span class="tool-status ${tool.status}">${icon(tool.status === "completed" ? "check-circle" : tool.status === "running" ? "spinner-gap" : "warning-circle")}${info[0]} · <span data-tool-elapsed="${esc(tool.id)}">${esc(elapsed)}</span></span></span>${icon("caret-down")}</summary><div class="tool-data">${presentation.html}<details class="tool-technical" data-disclosure="${esc(tool.id)}:technical" ${openTools.get(`${key}:technical`) ? "open" : ""}><summary>Detalles técnicos ${icon("caret-down")}</summary><code>${esc(tool.name)}</code><h4>Entrada original</h4><pre>${esc(JSON.stringify(tool.input, null, 2))}</pre><h4>Salida original</h4><pre>${tool.output === undefined ? "Sin respuesta" : esc(typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2))}</pre></details></div></details></article>`;
    })
    .join("");
  panel.querySelectorAll("[data-disclosure]").forEach((details) => {
    const key = `${call.id}:${details.dataset.disclosure}`;
    // The toggle event also fires on initial open; capturing the value is intentional.
    details.addEventListener("toggle", () => openTools.set(key, details.open));
  });
  if (atBottom && follow) panel.scrollTop = panel.scrollHeight;
  else panel.scrollTop = scroll;
  if (focusedTool)
    [...panel.querySelectorAll("[data-disclosure]")]
      .find((node) => node.dataset.disclosure === focusedTool)
      ?.querySelector("summary")
      .focus({ preventScroll: true });
}
function updateFollow() {
  const field = $("#follow-status");
  if (!currentCall) {
    field.innerHTML =
      '<span class="status-dot muted"></span>Esperando una llamada';
    return;
  }
  const atBottom =
    $("#transcript").scrollHeight -
      $("#transcript").clientHeight -
      $("#transcript").scrollTop <
    70;
  const label =
    currentCall.status !== "active"
      ? "Conversación finalizada"
      : demo
        ? "Demostración en curso"
        : connection !== "connected"
          ? "Reconectando…"
          : follow && atBottom
            ? "Siguiendo en directo"
            : "Seguimiento pausado";
  field.innerHTML = `<span class="status-dot ${currentCall.status !== "active" ? "muted" : ""}"></span>${label}`;
}
$("#transcript").addEventListener("scroll", updateFollow, { passive: true });
$("#jump-latest").addEventListener("click", () => {
  $("#transcript").scrollTo({
    top: $("#transcript").scrollHeight,
    behavior: motion(),
  });
});
$("#transcript").addEventListener("click", (event) => {
  if (event.target.closest("#start-demo")) startDemo();
  if (event.target.closest('[data-action="retry"]') && selectedId)
    void loadDetail(selectedId, true);
});
function renderEmpty() {
  document.title = "Lucía · Llamadas";
  $("#conversation-title").textContent = "Tu recepción, al día.";
  $("#call-meta").textContent =
    "Selecciona una llamada para ver su conversación.";
  $("#transcript-caption").textContent =
    "Una vista clara de cada conversación.";
  $("#transcript").innerHTML =
    '<div class="empty-state"><img src="/assets/lucia-orb.png" width="104" height="104" alt=""><h3>Todo empieza con una llamada.</h3><p>Cuando Lucía atienda, la conversación aparecerá aquí. En tiempo real, mensaje a mensaje.</p><button id="start-demo" class="button primary">Explorar una demostración</button><span class="empty-note">Sin llamadas reales ni cambios en tu agente.</span></div>';
  $("#tool-count").textContent = "0";
  $("#jump-latest").disabled = true;
  $("#tool-list").innerHTML =
    `<div class="tools-empty">${icon("path")}<h3>Todo tiene su porqué.</h3><p>Aquí verás qué consulta Lucía y qué respuesta recibe, paso a paso.</p></div>`;
  showConnection();
}
$("#back-history").addEventListener("click", () => {
  $("#workspace").dataset.mobileView = "history";
  $("#call-search").focus();
});
$("#show-tools").addEventListener("click", () => {
  $("#workspace").dataset.mobileView = "tools";
  $("#tools-title").focus({ preventScroll: true });
});
$("#hide-tools").addEventListener("click", () => {
  $("#workspace").dataset.mobileView = "conversation";
  $("#show-tools").focus();
});
window.addEventListener("popstate", () => {
  const id = new URL(location.href).searchParams.get("call");
  if (id && calls.some((call) => call.id === id)) selectCall(id, false);
  else {
    selectedId = undefined;
    currentCall = undefined;
    renderHistory();
    renderEmpty();
    $("#workspace").dataset.mobileView = "history";
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
    !$("#settings-dialog").open
  ) {
    event.preventDefault();
    $("#workspace").dataset.mobileView = "history";
    $("#call-search").focus();
  }
});

function tick() {
  for (const field of $$("[data-duration]")) {
    const call = calls.find((item) => item.id === field.dataset.duration);
    if (call) field.textContent = duration(call.startedAt, call.endedAt);
  }
  if (currentCall && $("#selected-duration"))
    $("#selected-duration").textContent = duration(
      currentCall.startedAt,
      currentCall.endedAt,
    );
  for (const field of $$("[data-tool-elapsed]")) {
    const tool = currentCall?.tools.find(
      (item) => item.id === field.dataset.toolElapsed,
    );
    if (tool?.status === "running")
      field.textContent = `${Math.max(
        0,
        (Date.now() - Date.parse(tool.startedAt)) / 1000,
      )
        .toFixed(1)
        .replace(".", ",")} s`;
  }
}
setInterval(tick, 1000);
setInterval(updateDate, 60_000);

// A small, explicitly simulated stream makes the main workflow reviewable without dialing a patient.
function startDemo() {
  if (providerDirty()) {
    requestCloseSettings();
    return;
  }
  closeSettings();
  events?.close();
  detailRequest?.abort();
  ++requestVersion;
  clearInterval(demoTimer);
  demo = true;
  demoStage = 0;
  storageError = false;
  demoCalls = createDemo();
  calls = demoCalls.map(summary);
  selectedId = undefined;
  currentCall = undefined;
  const url = new URL(location.href);
  url.searchParams.set("demo", "1");
  history.replaceState({}, "", url);
  renderHistory();
  selectCall(demoCalls[0].id, false);
  showConnection();
  demoTimer = setInterval(() => {
    const call = demoCalls[0];
    const tool = call.tools[2];
    demoStage += 1;
    if (demoStage === 1) {
      tool.status = "completed";
      tool.endedAt = new Date().toISOString();
      tool.durationMs = Date.parse(tool.endedAt) - Date.parse(tool.startedAt);
      tool.output = demoAvailability(Date.now(), 2);
    } else if (demoStage === 2) {
      call.transcript.push({
        id: "demo-new-1",
        role: "agent",
        text: "He encontrado dos opciones por la tarde. ¿Quieres que te las cuente?",
        at: new Date().toISOString(),
      });
    } else if (demoStage === 3) {
      call.transcript.push({
        id: "demo-new-2",
        role: "user",
        text: "Sí, perfecto. Gracias, Lucía.",
        at: new Date().toISOString(),
      });
    } else {
      clearInterval(demoTimer);
      return;
    }
    call.revision += 1;
    calls = demoCalls.map(summary);
    renderHistory();
    if (selectedId === call.id) {
      currentCall = call;
      renderDetail();
    }
  }, 6500);
}
function endDemo() {
  clearInterval(demoTimer);
  lastToolsSignature = "";
  demo = false;
  demoCalls = [];
  calls = [];
  selectedId = undefined;
  currentCall = undefined;
  const url = new URL(location.href);
  url.searchParams.delete("demo");
  url.searchParams.delete("call");
  history.replaceState({}, "", url);
  renderEmpty();
  connect();
}
$("#exit-demo").addEventListener("click", endDemo);
$("#settings-demo").addEventListener("click", startDemo);

function providerDirty() {
  return (
    settingsLoaded &&
    ($("#agent-id").value !== providerInitial || Boolean($("#api-key").value))
  );
}
function providerFeedback(text, tone = "") {
  const field = $("#provider-feedback");
  field.className = `inline-feedback ${tone}`;
  field.textContent = text;
}
function setProviderBusy(busy, kind = "") {
  providerBusy = busy;
  $("#save-provider").disabled = busy || !settingsLoaded || demo;
  $("#test-provider").disabled = busy || !settingsLoaded || demo;
  $("#agent-id").disabled = busy || !settingsLoaded || demo;
  $("#api-key").disabled = busy || !settingsLoaded || demo;
  $("#provider-form").setAttribute("aria-busy", String(busy));
  $("#save-provider").textContent =
    busy && kind === "save" ? "Guardando…" : "Guardar proveedor";
  $("#test-provider").innerHTML =
    `${icon(busy && kind === "test" ? "spinner-gap" : "plugs-connected")}${busy && kind === "test" ? "Conectando…" : "Probar conexión"}`;
  $("#test-provider").classList.toggle("busy", busy && kind === "test");
}
async function openSettings() {
  const dialog = $("#settings-dialog");
  dialog.showModal();
  $("#close-settings").focus();
  $("#discard-changes").hidden = true;
  settingsLoaded = false;
  setProviderBusy(false);
  $("#provider-loading").textContent = demo
    ? "Demostración: vuelve al directo para configurar el proveedor."
    : "Cargando configuración…";
  $("#api-key").value = "";
  providerFeedback("");
  if (demo) {
    $("#agent-id").value = "agent_demo";
    providerInitial = "agent_demo";
    return;
  }
  settingsRequest?.abort();
  settingsRequest = new AbortController();
  try {
    const settings = await api("/api/settings", {
      signal: settingsRequest.signal,
    });
    if (!dialog.open) return;
    settingsLoaded = true;
    providerInitial = settings.agentId;
    $("#agent-id").value = settings.agentId;
    $("#key-configured").hidden = !settings.hasApiKey;
    $("#api-key").placeholder = settings.hasApiKey
      ? "••••••••••••••••"
      : "Introduce tu clave API";
    $("#provider-loading").textContent = settings.hasApiKey
      ? settings.source === "keychain"
        ? "Credenciales guardadas en el Llavero de macOS."
        : "Usando la configuración del entorno."
      : "Conecta ElevenLabs para empezar a recibir llamadas.";
    setProviderBusy(false);
  } catch (error) {
    if (error.name !== "AbortError") {
      $("#provider-loading").textContent =
        "No se pudo cargar la configuración. Cierra y vuelve a abrir los ajustes para reintentar.";
      providerFeedback(error.message, "error");
    }
  }
}
function closeSettings() {
  if (!$("#settings-dialog").open) return;
  settingsRequest?.abort();
  $("#api-key").value = "";
  $("#api-key").type = "password";
  $("#show-key").setAttribute("aria-label", "Mostrar clave API");
  $("#show-key").setAttribute("aria-pressed", "false");
  $("#show-key").innerHTML = icon("eye");
  $("#settings-dialog").close();
  settingsLoaded = false;
  $("#open-settings").focus();
}
function requestCloseSettings() {
  if (providerBusy) {
    providerFeedback("Espera a que termine la operación antes de cerrar.");
    return;
  }
  if (providerDirty()) {
    $("#discard-changes").hidden = false;
    $("#keep-editing").focus();
  } else closeSettings();
}
$("#open-settings").addEventListener("click", openSettings);
$("#close-settings").addEventListener("click", requestCloseSettings);
$("#settings-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  requestCloseSettings();
});
$("#keep-editing").addEventListener("click", () => {
  $("#discard-changes").hidden = true;
  $("#agent-id").focus();
});
$("#discard-provider").addEventListener("click", closeSettings);
$("#show-key").addEventListener("click", () => {
  const show = $("#api-key").type === "password";
  $("#api-key").type = show ? "text" : "password";
  $("#show-key").setAttribute(
    "aria-label",
    show ? "Ocultar clave API" : "Mostrar clave API",
  );
  $("#show-key").setAttribute("aria-pressed", String(show));
  $("#show-key").innerHTML = icon(show ? "eye-slash" : "eye");
});
async function submitProvider(kind) {
  if (providerBusy || !settingsLoaded || demo) return;
  $("#agent-id").removeAttribute("aria-invalid");
  $("#api-key").removeAttribute("aria-invalid");
  const draft = {
    agentId: $("#agent-id").value.trim(),
    apiKey: $("#api-key").value.trim(),
  };
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(draft.agentId)) {
    providerFeedback("Introduce un identificador de agente válido.", "error");
    $("#agent-id").setAttribute("aria-invalid", "true");
    $("#agent-id").focus();
    return;
  }
  if (!draft.apiKey && $("#key-configured").hidden) {
    providerFeedback("Introduce la clave API de ElevenLabs.", "error");
    $("#api-key").setAttribute("aria-invalid", "true");
    $("#api-key").focus();
    return;
  }
  setProviderBusy(true, kind);
  providerFeedback(
    kind === "save" ? "Guardando de forma segura…" : "Comprobando el agente…",
  );
  try {
    const result = await api(
      kind === "save" ? "/api/settings" : "/api/settings/test",
      { method: "POST", body: JSON.stringify(draft) },
    );
    if (kind === "save") {
      providerInitial = result.agentId;
      $("#agent-id").value = result.agentId;
      $("#api-key").value = "";
      $("#key-configured").hidden = false;
      $("#api-key").placeholder = "••••••••••••••••";
      $("#provider-loading").textContent =
        "Credenciales guardadas en el Llavero de macOS.";
      $("#discard-changes").hidden = true;
      providerFeedback(
        "Proveedor guardado. Se aplicará a las próximas llamadas.",
        "success",
      );
    } else providerFeedback(`Conexión correcta con ${result.name}.`, "success");
  } catch (error) {
    providerFeedback(error.message, "error");
  } finally {
    setProviderBusy(false);
  }
}
$("#provider-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitProvider("save");
});
$("#test-provider").addEventListener(
  "click",
  () => void submitProvider("test"),
);
window.addEventListener("beforeunload", (event) => {
  if (providerDirty() || providerBusy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  events?.close();
  clearInterval(demoTimer);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !demo) connect();
});

if (new URL(location.href).searchParams.get("demo") === "1") startDemo();
else connect();
