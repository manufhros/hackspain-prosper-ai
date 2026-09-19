import { EventEmitter } from "node:events";
import { handleCall, type CallOptions } from "../agent/session.ts";
import { LiveBridge } from "../agent/live-bridge.ts";
import type { CallSocket } from "../agent/socket.ts";
import { loadPatients, patientReply, type Patient, type Turn } from "./patient.ts";
import { checkPhone, dialPatient, stopPhone, phoneStatus } from "./twilio.ts";
import { authorized, phoneToken, validPhoneToken } from "./security.ts";
import { checkAgent } from "./agent-config.ts";
import { agentReplyTwiml, startCallMediaStream } from "../agent/twilio-transfer.ts";
import { PatientPhoneSocket } from "./phone-socket.ts";
import { DEMO_NUMBER, TwilioRequestError } from "./twilio.ts";

type Entry = { type: string; at: number; text?: string; name?: string; result?: string; language?: string };
export type OperationCall = { id: string; name: string; source: "llm" | "phone"; state: string; started: number; ended?: number; events: Entry[] };
export type DemoState = { id: string; state: string; message: string; calls: OperationCall[] };
type Dependencies = {
  options: CallOptions; origin: () => string;
  core?: typeof handleCall; patients?: typeof loadPatients; reply?: typeof patientReply;
  checkPhone?: typeof checkPhone; dial?: typeof dialPatient; hangup?: typeof stopPhone; status?: typeof phoneStatus;
  checkAgent?: typeof checkAgent;
  startStream?: typeof startCallMediaStream;
  verifyWebhook?: (url: string, callId: string) => Promise<void>;
  checkpoint?: (value: { id: string; sid?: string; active: boolean }) => Promise<void>;
};
class MemorySocket extends EventEmitter implements CallSocket {
  readyState = 1;
  send(_data: string) {}
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit("close", 1000, ""); }
  input(data: unknown) { if (this.readyState === 1) this.emit("message", JSON.stringify(data)); }
}

export class OperationsService {
  private run: DemoState = { id: "", state: "idle", message: "", calls: [] };
  private controller = new AbortController();
  private sockets = new Set<CallSocket>();
  private sid: string | undefined;
  private starting = false;
  private dialing = false;
  private phoneConnected = false;
  private phoneReplies: string[] = [];
  private phoneStreamRequested = false;
  private phoneStreamDeadline: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private task: Promise<void> = Promise.resolve();
  constructor(private readonly deps: Dependencies) {}
  get active() { return this.starting || ["preparing", "running", "stopping", "uncertain"].includes(this.run.state); }
  snapshot() { return structuredClone(this.run); }
  async acknowledge() {
    if (this.starting || this.run.state !== "uncertain") throw new Error("Solo se puede confirmar una ejecución incierta detenida.");
    if (this.run.calls.some(call => call.source === "llm" && !call.ended)) throw new Error("Espera a que terminen los pacientes LLM o detén la demo.");
    this.dialing = false; this.sid = undefined;
    this.run.state = "finished"; this.run.message = "Cierre comprobado manualmente en Twilio.";
    await this.checkpoint(false);
    return this.snapshot();
  }
  recover(id: string, sid?: string) {
    this.run = { id, state: "uncertain", message: "El servicio se reinició. Detén la ejecución antes de volver a iniciar.", calls: [] };
    this.sid = sid;
  }
  private checkpoint(active: boolean) {
    return this.deps.checkpoint?.({ id: this.run.id, ...(this.sid ? { sid: this.sid } : {}), active }) ?? Promise.resolve();
  }
  private event(call: OperationCall, event: Record<string, unknown>) {
    if (call.ended) return;
    const type = String(event.type ?? "event");
    if (type === "ready") call.state = "En conversación";
    if (call.source === "phone" && type === "agent" && typeof event.text === "string") {
      this.phoneReplies.push(event.text);
    }
    call.events.push({
      type, at: Date.now(),
      ...(typeof event.text === "string" ? { text: event.text } : {}),
      ...(typeof event.name === "string" ? { name: event.name } : {}),
      ...(typeof event.result === "string" ? { result: event.result } : {}),
      ...(typeof event.language === "string" ? { language: event.language } : {}),
    });
    if (call.events.length > 600) call.events.shift();
  }
  private end(call: OperationCall, state = "Finalizada") {
    if (call.ended) return;
    call.ended = Date.now(); call.state = state;
    if (!this.starting && this.run.calls.every(item => item.ended) && this.run.state === "running") {
      void this.stop();
    }
  }
  private async failPhone(call: OperationCall, message: string) {
    this.event(call, { type: "error", text: message });
    clearInterval(this.poll); clearTimeout(this.phoneStreamDeadline);
    try {
      if (this.sid) await (this.deps.hangup ?? stopPhone)(this.sid);
      this.end(call, "Error de teléfono");
    } catch {
      this.run.state = "uncertain";
      this.run.message = "No se ha podido confirmar el cierre del teléfono. Los pacientes LLM continúan.";
    }
  }
  private options(call: OperationCall, observe?: (event: Record<string, unknown>) => void): CallOptions {
    return { ...this.deps.options, demo: true, liveBridge: new LiveBridge(),
      onMonitor: event => { this.event(call, event); observe?.(event); },
      onEnd: () => this.end(call),
    };
  }
  private async patient(profile: Patient, call: OperationCall) {
    const socket = new MemorySocket();
    this.sockets.add(socket);
    const signal = this.controller.signal;
    const history: Turn[] = [];
    let revision = 0, answered = -1, turns = 0, thinking = false;
    let timer: ReturnType<typeof setTimeout>;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const startup = setTimeout(() => { rejectReady(new Error("ElevenLabs no ha iniciado la sesión.")); socket.close(); }, 30000);
    const close = () => socket.close();
    signal.addEventListener("abort", close, { once: true });
    socket.once("close", () => {
      clearTimeout(timer); clearTimeout(startup); signal.removeEventListener("abort", close);
      this.sockets.delete(socket); rejectReady(new Error("Sesión cerrada antes de estar lista.")); this.end(call);
    });
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void respond(), 1600); };
    const respond = async () => {
      if (thinking || signal.aborted || socket.readyState !== 1 || answered === revision) return;
      if (turns >= 18) { this.event(call, { type: "limit", text: "Límite de 18 turnos" }); socket.close(); return; }
      thinking = true;
      const version = revision;
      try {
        const text = await (this.deps.reply ?? patientReply)(profile, history, signal);
        if (signal.aborted || socket.readyState !== 1) return;
        if (version !== revision) return;
        answered = version;
        if (text === "[FIN]") { socket.close(); return; }
        turns++;
        history.push({ type: "user", text });
        socket.input({ event: "user_text", text });
      } catch {
        if (!signal.aborted) { this.event(call, { type: "error", text: "El paciente LLM no pudo responder." }); this.end(call, "Error"); socket.close(); }
      } finally { thinking = false; if (!signal.aborted && socket.readyState === 1 && version !== revision) schedule(); }
    };
    await (this.deps.core ?? handleCall)(socket, {
      ...this.options(call, event => {
        if (event.type === "ready") { clearTimeout(startup); resolveReady(); }
        if (event.type === "agent" && typeof event.text === "string") {
          history.push({ type: "agent", text: event.text }); revision++; schedule();
        }
      }), textOnly: true,
    });
    if (signal.aborted) socket.close();
    else socket.input({ event: "start", start: { streamSid: call.id, callSid: call.id, customParameters: {
      call_id: call.id, org_slug: "arenal", simulation: "operations",
      from_number: String(profile.data.phone ?? ""),
    } } });
    return ready;
  }
  start(includePhone = true) {
    if (this.active) throw new Error("Ya hay una demo activa o pendiente de comprobar.");
    this.controller = new AbortController(); this.sid = undefined; this.phoneConnected = false;
    this.phoneReplies = []; this.phoneStreamRequested = false;
    this.run = { id: crypto.randomUUID(), state: "preparing", message: "Comprobando configuración y pacientes…", calls: [] };
    this.starting = true;
    this.task = this.launch(includePhone);
    this.deps.options.waitUntil?.(this.task);
    return this.snapshot();
  }
  private async launch(includePhone: boolean) {
    const signal = this.controller.signal;
    try {
      for (const key of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "PLATFORM_API_KEY"]) {
        if (!process.env[key]) throw new Error(`Falta ${key}.`);
      }
      if (includePhone) {
        if (!this.deps.origin().startsWith("https://")) throw new Error("Configura VOICE_AGENT_PUBLIC_URL con HTTPS.");
        await (this.deps.checkPhone ?? checkPhone)();
      }
      await (this.deps.checkAgent ?? checkAgent)();
      const patients = await (this.deps.patients ?? loadPatients)();
      if (signal.aborted) return;
      await this.checkpoint(true);
      this.run.calls = patients.map((profile, i) => ({
        id: `demo-${this.run.id}-${i}`, name: profile.name, source: "llm", state: "Conectando", started: Date.now(), events: [],
      }));
      this.timer = setTimeout(() => void this.stop(), 300000);
      await Promise.all(patients.map((profile, i) => this.patient(profile, this.run.calls[i]!)));
      if (signal.aborted) return;
      this.run.state = "running"; this.run.message = "Ensayo · Sin cambios en la agenda real";
      if (includePhone) {
        const call: OperationCall = { id: `demo-${this.run.id}-phone`, name: "Tu teléfono · ••• 8225", source: "phone", state: "Llamando", started: Date.now(), events: [] };
        this.run.calls.push(call);
        const expires = String(Date.now() + 360000);
        const url = `${this.deps.origin()}/operations/phone/${this.run.id}/${expires}/${phoneToken(this.run.id, expires)}`;
        await (this.deps.verifyWebhook ?? (async (endpoint, callId) => {
          const response = await fetch(endpoint, { headers: { "ngrok-skip-browser-warning": "true" }, signal: AbortSignal.timeout(5000) });
          const xml = await response.text();
          if (!response.ok || !xml.includes("<Redirect ") || !xml.includes(callId)) throw new Error("La URL pública no devuelve las instrucciones de esta demo. Revisa el despliegue de voz.");
        }))(url, call.id);
        if (signal.aborted) return;
        this.dialing = true;
        const result = await (this.deps.dial ?? dialPatient)(url);
        if (!result.sid) throw new Error("Twilio no devolvió un identificador de llamada.");
        this.sid = result.sid; this.dialing = false;
        await this.checkpoint(true);
        if (signal.aborted) { await (this.deps.hangup ?? stopPhone)(this.sid); return; }
        let polling = false;
        this.poll = setInterval(() => {
          if (polling || !this.sid || signal.aborted) return;
          polling = true;
          void (this.deps.status ?? phoneStatus)(this.sid).then(async status => {
            if (signal.aborted) return;
            if (status.status === "in-progress" && !this.phoneStreamRequested) {
              this.phoneStreamRequested = true;
              this.event(call, { type: "transport", text: "Iniciando audio entrante mediante el flujo REST de Lucía" });
              try {
                const result = await (this.deps.startStream ?? startCallMediaStream)(this.sid!, `${url.replace(/^https:/, "wss:")}/ws`);
                if (signal.aborted) return;
                if (!result?.ok) throw new Error(result?.error || `Twilio Streams HTTP ${result?.status ?? "sin respuesta"}`);
                this.event(call, { type: "transport", text: "Twilio aceptó el stream; esperando conexión de audio" });
                this.phoneStreamDeadline = setTimeout(() => {
                  if (this.phoneConnected || signal.aborted) return;
                  void this.failPhone(call, "Twilio aceptó el stream pero no conectó el audio en 20 segundos.");
                }, 20000);
              } catch (error) {
                await this.failPhone(call, error instanceof Error ? error.message : "No se pudo abrir el stream de Twilio.");
              }
            }
            if (["completed", "failed", "busy", "no-answer", "canceled"].includes(status.status ?? "")) {
              if (!this.phoneConnected) this.event(call, { type: "error", text: "La llamada terminó sin abrir audio con ElevenLabs." });
              this.end(call, this.phoneConnected ? "Finalizada" : "Sin conexión de audio");
              clearInterval(this.poll);
            }
          }).catch(() => {}).finally(() => { polling = false; });
        }, 3000);
      }
    } catch (error) {
      const phone = this.run.calls.find(call => call.source === "phone");
      if (phone && !signal.aborted) {
        const detail = error instanceof Error ? error.message : "Fallo de teléfono";
        this.event(phone, { type: "error", text: detail });
        if (error instanceof TwilioRequestError && error.rejected && !this.sid) this.dialing = false;
        if (this.dialing || this.sid) {
          this.run.state = "uncertain";
          phone.state = "Estado desconocido";
          this.run.message = `${detail}. Comprueba la llamada en Twilio. Los tres pacientes LLM continúan.`;
        } else {
          this.run.state = "running";
          this.run.message = `${detail}. El teléfono no se inició; los tres pacientes LLM continúan.`;
          this.end(phone, "No iniciada");
        }
        // The phone is independent: do not abort the three AI conversations.
        return;
      }
      if (this.dialing || this.sid) {
        this.run.state = "uncertain";
        this.run.message = "Respuesta incierta de Twilio. Comprueba Calls antes de volver a iniciar.";
      } else if (!signal.aborted) {
        this.run.state = "error"; this.run.message = error instanceof Error ? error.message : "No se pudo iniciar la demo.";
      }
      this.controller.abort();
      for (const socket of this.sockets) socket.close();
    } finally {
      this.starting = false;
      if (signal.aborted) { clearTimeout(this.timer); clearInterval(this.poll); }
      if (signal.aborted && this.run.state !== "uncertain") await this.checkpoint(false);
      if (this.run.state === "running" && this.run.calls.every(call => call.ended)) void this.stop();
    }
  }
  async stop() {
    if (this.run.state !== "uncertain") this.run.state = "stopping";
    this.controller.abort(); clearTimeout(this.timer); clearInterval(this.poll); clearTimeout(this.phoneStreamDeadline);
    for (const socket of this.sockets) socket.close();
    await this.task;
    try {
      if (this.sid) await (this.deps.hangup ?? stopPhone)(this.sid);
      else if (this.dialing || this.run.state === "uncertain") throw new Error("Confirma en Twilio el estado de la llamada antes de reiniciar el servicio.");
      this.run.calls.forEach(call => this.end(call));
      this.run.state = "finished"; this.run.message = "Ensayo finalizado";
      await this.checkpoint(false);
    } catch {
      this.run.state = "uncertain"; this.run.message = "No se ha podido confirmar el cierre en Twilio. Revisa Calls.";
    }
    return this.snapshot();
  }
  phoneAllowed(url: URL) {
    const parts = url.pathname.split("/");
    const check = new URL(url);
    check.searchParams.set("expires", parts[4] ?? ""); check.searchParams.set("token", parts[5] ?? "");
    return parts[3] === this.run.id && this.active && !this.controller.signal.aborted && validPhoneToken(check, this.run.id);
  }
  async attachPhone(socket: CallSocket) {
    const call = this.run.calls.find(item => item.source === "phone");
    if (!call || this.phoneConnected || this.controller.signal.aborted) { socket.close(1008, "No active phone session"); return; }
    this.phoneConnected = true; this.sockets.add(socket);
    clearTimeout(this.phoneStreamDeadline);
    socket.once("close", () => { this.sockets.delete(socket); this.end(call); });
    await (this.deps.core ?? handleCall)(new PatientPhoneSocket(socket, call.id, DEMO_NUMBER), this.options(call));
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/operations/phone/")) {
      if (!this.phoneAllowed(url)) return new Response("Forbidden", { status: 403 });
      const callId = this.run.calls.find(call => call.source === "phone")?.id ?? "";
      // GET is a side-effect-free preflight. Only Twilio's POST consumes queued replies.
      const text = request.method === "POST" ? this.phoneReplies.splice(0).join(" ") : "";
      return new Response(agentReplyTwiml(text, `${this.deps.origin()}${url.pathname}`, callId), {
        headers: { "content-type": "text/xml", "cache-control": "no-store" },
      });
    }
    if (!authorized(request)) return Response.json({ error: "No autorizado" }, { status: 403 });
    try {
      if (url.pathname === "/operations/state" && request.method === "GET") return Response.json(this.snapshot(), { headers: { "cache-control": "no-store" } });
      if (request.method === "POST" && url.pathname === "/operations/start") {
        const body = await request.json() as { includePhone?: boolean };
        return Response.json(this.start(body.includePhone !== false), { status: 202 });
      }
      if (request.method === "POST" && url.pathname === "/operations/stop") return Response.json(await this.stop());
      if (request.method === "POST" && url.pathname === "/operations/acknowledge") return Response.json(await this.acknowledge());
      return new Response("Not found", { status: 404 });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Error" }, { status: 409 }); }
  }
}
