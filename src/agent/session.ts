import { spokenIdentity, summaryIdentity } from "./caller-identity.ts";
import { motiveFrom, substantive } from "./call-text.ts";
import { currentAuditContext, withAuditContext } from "./audit.ts";
import { SOCKET_OPEN, type CallSocket } from "./socket.ts";
import { PlatformClient } from "../platform/client.ts";
import { callLog, callLogError, callLogWarn } from "./call-log.ts";
import { extractClientToolCall, getSignedConversationUrl } from "./elevenlabs.ts";
import { holdFrame } from "./hold-audio.ts";
import {
  PATIENT_SPEECH,
  phoneHelperTranscript,
} from "./twilio-transfer.ts";
import { actionToolBlocked, clinicTodayYmd, flushPendingSubmit, runClinicTool, type CallContext } from "./tools.ts";
import { applyAgentPrompt, conversationConfigOverride, loadRuntimeConfig as loadLocalRuntimeConfig } from "./runtime-config.ts";
import { deliverPostCall, emitCallEvent as emitLocalCallEvent } from "./call-event.ts";
import {
  KEEP_PHONE_MS,
  nodeLiveBridge,
  type LiveBridge,
  parseJoinPath,
  type LiveSession,
  type PhoneSink,
} from "./live-bridge.ts";

type TwilioStart = {
  event: "start";
  start: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
};

type TwilioMedia = {
  event: "media";
  streamSid: string;
  media: { payload: string };
};

type TwilioMessage = TwilioStart | TwilioMedia | { event: string; [key: string]: unknown };

const MAX_PENDING = 2000;

function madridToday(): string {
  return clinicTodayYmd();
}

type PreCallContext = {
  hint: string;
  patientName: string;
  insurer: string;
  patientId: string;
};

async function lookupByPhone(
  platform: PlatformClient,
  fromNumber?: string,
): Promise<PreCallContext> {
  if (!fromNumber) return { hint: "", patientName: "", insurer: "", patientId: "" };
  try {
    const found = await platform.directory({ phone: fromNumber });
    const one = found.matches.length === 1 ? found.matches[0] : undefined;
    return {
      hint: JSON.stringify(
      found.matches.map((match) => ({
        patient_id: match.patient_id,
        name: `${match.given_name} ${match.first_surname} ${match.second_surname}`,
        insurer: match.insurer,
        has_visited_before: match.has_visited_before,
        note: match.note,
      })),
      ),
      patientName: one
        ? `${one.given_name} ${one.first_surname} ${one.second_surname}`.trim()
        : "",
      insurer: one?.insurer ?? "",
      patientId: one?.patient_id ?? "",
    };
  } catch (error) {
    callLogError("directory hint", error);
    return { hint: "", patientName: "", insurer: "", patientId: "" };
  }
}

function routeFor(text: string): { intent: string; route: "general" | "actions" | "human" } {
  const value = text.toLowerCase();
  if (/urgencia|emergencia|pecho|respirar|sangr|desmay/.test(value)) {
    return { intent: "medical_emergency", route: "human" };
  }
  if (/reserv|cita|cancel|anul|mover|cambiar|alta|registr/.test(value)) {
    return { intent: "appointment_action", route: "actions" };
  }
  return { intent: "general_faq", route: "general" };
}

function frustrationDelta(text: string): number {
  const value = text.toLowerCase();
  let score = 0;
  if (/ya te lo he dicho|otra vez|no me entiendes|persona|humano|operador/.test(value)) score += 30;
  if (/fatal|ridículo|inútil|harto|enfadad|frustrad/.test(value)) score += 35;
  if (/[!¡]{2,}/.test(value)) score += 10;
  return score;
}

function transcriptLanguage(text: string): "es" | "en" | undefined {
  const value = text.toLowerCase();
  if (
    /[áéíóúñ¿¡]/.test(value) ||
    /\b(hola|buenos|sí|soy|quiero|cita|gracias|otra|nada|mejor|puede|necesito|adiós|por favor)\b/.test(
      value,
    )
  ) {
    return "es";
  }
  if (
    /\b(hello|hi|yes|please|appointment|thank|actually|change|name|sure|wait|week|doctor)\b/.test(
      value,
    )
  ) {
    return "en";
  }
  return undefined;
}

function clinicNameFor(orgSlug: string): string {
  if (orgSlug === "quironsalud") return "Clínica Quirón";
  if (orgSlug === "sanitas") return "Clínica Sanitas";
  return "Clínica Arenal";
}

export type CallOptions = {
  /** Server-only demo controls, never inferred from untrusted WebSocket parameters. */
  demo?: boolean;
  textOnly?: boolean;
  onMonitor?: (event: Record<string, unknown>) => void;
  liveBridge?: LiveBridge;
  requestUrl?: string;
  handoffUrl?: string;
  joinOnly?: boolean;
  onEnd?: () => void;
  connect: (url: string) => Promise<CallSocket>;
  loadConfig?: typeof loadLocalRuntimeConfig;
  emitEvent?: (...args: Parameters<typeof emitLocalCallEvent>) => ReturnType<typeof emitLocalCallEvent> | Promise<ReturnType<typeof emitLocalCallEvent>>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export async function handleCall(twilio: CallSocket, options: CallOptions): Promise<void> {
  const pathJoin = parseJoinPath(options.requestUrl ?? "/ws");
  const bridge = options.liveBridge ?? nodeLiveBridge;
  const { getLiveSession, liveSessionIds, markPhoneJoined, registerLiveSession, sessionKeptForPhone, unregisterLiveSession } = bridge;
  const loadRuntimeConfig = options.loadConfig ?? loadLocalRuntimeConfig;
  let streamSid: string | undefined;
  let ctx: CallContext | undefined;
  let eleven: CallSocket | undefined;
  let elevenReady = false;
  let pendingTools = 0;
  const pendingAudio: string[] = [];
  let holdTimer: ReturnType<typeof setInterval> | undefined;
  let holdTick = 0;
  let pendingHint: string | undefined;
  let startedAt = Date.now();
  let toolCalls = 0;
  let toolErrors = 0;
  let finalised = false;
  let stopped = false;
  let site: string | undefined;
  const toolTasks = new Set<Promise<unknown>>();
  let finishing: Promise<void> | undefined;
  let simulationMode = false;
  let lastDetectedLanguage: "es" | "en" | undefined;
  const phones: PhoneSink[] = [];
  let joinedHost: LiveSession | undefined;
  let sourceStopped = false;
  let retentionTimer: ReturnType<typeof setTimeout> | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let connectEleven: (() => Promise<void>) | undefined;
  let elevenReconnects = 0;
  let muteAgent = false;
  let handedOff = false;
  let patientAnnounced = false;

  const background = (promise: Promise<unknown>) => {
    const handled = promise.catch((error: unknown) => callLogError("call task failed", error));
    if (options.waitUntil) options.waitUntil(handled);
    else void handled;
  };

  const emitCallEvent = (...args: Parameters<typeof emitLocalCallEvent>) => {
    const [type, callId, version, payload = {}] = args;
    const promise = Promise.resolve().then(() => (options.emitEvent ?? emitLocalCallEvent)(
      type, callId, version, { ...payload, origin: options.demo || simulationMode ? "simulator" : "phone", orgSlug: ctx?.orgSlug ?? "arenal", demo: options.demo ?? false, zeroRetention: ctx?.zeroRetention ?? true },
    ));
    background(promise);
    return promise;
  };

  const finalise = async (callCtx: CallContext) => {
    if (finalised) return;
    finalised = true;
    stopped = true;
    stopHold();
    eleven?.close();
    twilio.close();
    clearTimeout(retentionTimer);
    clearTimeout(durationTimer);
    unregisterLiveSession(callCtx.callId);
    for (const phone of [...phones]) phone.ws.close();
    options.onEnd?.();
    const summary = {
      callId: callCtx.callId,
      orgSlug: callCtx.orgSlug,
      ...(site ? { site } : {}),
      configVersion: callCtx.configVersion ?? "defaults",
      outcome: callCtx.outcome ?? (callCtx.submitted ? "submitted" : "sin_cierre"),
      ...(callCtx.outcomeReason ? { reason: callCtx.outcomeReason } : {}),
      ...(callCtx.route ? { route: callCtx.route } : {}),
      ...(callCtx.intent ? { intent: callCtx.intent } : {}),
      ...(callCtx.motive ? { motive: callCtx.motive } : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
      userTurns: callCtx.userTurns ?? 0,
      toolCalls,
      toolErrors,
      frustrationScore: callCtx.frustrationScore ?? 0,
      zeroRetention: callCtx.zeroRetention ?? true,
    };
    await emitCallEvent("call.ended", callCtx.callId, callCtx.configVersion ?? "defaults", { ...summary, ...summaryIdentity(callCtx) });
    if (callCtx.postCallWebhook && !options.demo) {
      await deliverPostCall(summary, callCtx.postCallEndpoint, callCtx.audit).catch((error: unknown) => {
        callLogError(callCtx.callId.slice(0, 8), "post-call failed", error);
      });
    }
  };

  const finish = (callCtx: CallContext) => {
    finishing ??= (async () => {
      await Promise.allSettled([...toolTasks]);
      try {
        await flushPendingSubmit(callCtx);
      } catch (error) {
        callLogError("flush on call end failed", error);
      }
      await finalise(callCtx);
    })();
    return finishing;
  };

  const sendEleven = (payload: unknown) => {
    if (eleven?.readyState === SOCKET_OPEN) {
      eleven.send(JSON.stringify(payload));
    }
  };

  const sendTwilio = (payload: unknown) => {
    if (twilio.readyState === SOCKET_OPEN) {
      twilio.send(JSON.stringify(payload));
    }
  };

  const sendToPhones = (payload: string) => {
    for (const phone of phones) {
      if (phone.ws.readyState === SOCKET_OPEN) {
        phone.ws.send(JSON.stringify({
          event: "media",
          streamSid: phone.streamSid,
          media: { payload },
        }));
      }
    }
  };

  const sendAgentAudio = (payload: string) => {
    if (!sourceStopped && streamSid && twilio.readyState === SOCKET_OPEN) {
      sendTwilio({ event: "media", streamSid, media: { payload } });
    }
    sendToPhones(payload);
  };

  const sendMonitor = (monitor: Record<string, unknown>) => {
    options.onMonitor?.(monitor);
    sendTwilio({ event: "monitor", monitor });
  };

  const queueAudio = (chunk: string) => {
    pendingAudio.push(chunk);
    if (pendingAudio.length > MAX_PENDING) pendingAudio.shift();
  };

  const flushAudio = () => {
    for (const chunk of pendingAudio) {
      sendEleven({ user_audio_chunk: chunk });
    }
    pendingAudio.length = 0;
  };

  const stopHold = () => {
    if (holdTimer) {
      clearInterval(holdTimer);
      holdTimer = undefined;
    }
  };

  const playHold = () => {
    if (stopped || holdTimer || twilio.readyState !== SOCKET_OPEN || !streamSid) return;
    holdTick = 0;
    holdTimer = setInterval(() => {
      if (twilio.readyState !== SOCKET_OPEN || !streamSid || elevenReady) {
        stopHold();
        return;
      }
      sendAgentAudio(holdFrame(holdTick));
      holdTick += 1;
    }, 20);
  };

  const keepTwilioAlive = () => {
    playHold();
  };

  const announceSimulatedPatient = () => {
    if (patientAnnounced) return;
    patientAnnounced = true;
    sendMonitor({ type: "user", text: PATIENT_SPEECH, language: "es", role: "patient" });
  };

  const hostStillNeeded = () =>
    !stopped && (phones.length > 0 || (ctx != null && sessionKeptForPhone(ctx.callId)));

  const finishIfUnused = () => {
    if (!sourceStopped || !ctx || stopped) return;
    if (hostStillNeeded()) {
      clearTimeout(retentionTimer);
      retentionTimer = setTimeout(finishIfUnused, KEEP_PHONE_MS);
      return;
    }
    stopped = true;
    background(finish(ctx));
    closeElevenSoon();
  };

  const sourceEnded = () => {
    sourceStopped = true;
    stopHold();
    background(Promise.allSettled([...toolTasks]).then(finishIfUnused));
  };

  const closeElevenSoon = () => {
    if (hostStillNeeded()) {
      callLog(ctx?.callId.slice(0, 8) ?? "session", "keep eleven for phone");
      return;
    }
    stopHold();
    const wait = pendingTools > 0 ? 8000 : 5000;
    setTimeout(() => {
      if (hostStillNeeded()) return;
      eleven?.close();
    }, wait);
  };

  const isPauseTranscript = (text: string) =>
    /^\.{2,}$/i.test(text.trim()) || /^(um+|uh+|hmm+|mhm+|mm+)\.?$/i.test(text.trim());

  const isNudgeSpeech = (text: string) =>
    /still there|anyone there|can you hear me|if you are there|whenever you are ready to speak/i.test(
      text,
    );

  const emitHelperSpeech = (
    callCtx: CallContext,
    tag: string,
    raw: string,
    partial = false,
  ) => {
    const spoken = phoneHelperTranscript(raw);
    if (!spoken) return;
    if (!partial) {
      callLog(tag, "helper", spoken);
      background(callCtx.audit?.("conversation.user", { text: spoken, source: "phone" }) ?? Promise.resolve());
      callCtx.transcript = [
        ...(callCtx.transcript ?? []),
        { speaker: "caller" as const, text: spoken },
      ].slice(-12);
    }
    sendMonitor({
      type: "helper",
      text: spoken,
      language: transcriptLanguage(spoken),
      partial,
    });
  };

  const attachEleven = (socket: CallSocket, callCtx: CallContext) => {
    eleven = socket;
    const tag = callCtx.callId.slice(0, 8);
    socket.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();
      let message: unknown;
      try {
        message = JSON.parse(text) as unknown;
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null) return;
      const typed = message as {
        type?: string;
        ping_event?: { event_id: number; ping_ms?: number };
        audio_event?: { audio_base_64: string };
        audio?: { chunk?: string };
      };

      if (typed.type && typed.type !== "audio" && typed.type !== "ping" && typed.type !== "vad_score") {
        callLog(tag, "eleven", typed.type);
      }

      if (typed.type === "conversation_initiation_metadata") {
        sendMonitor({ type: "ready" });
        if (options.demo) sendEleven({ type: "contextual_update", text: "This is a rehearsal. All appointment actions are simulated; never describe them as real confirmed appointments. Start in Spanish and switch only after hearing the caller." });
        elevenReady = true;
        flushAudio();
        if (pendingHint) {
          sendEleven({ type: "contextual_update", text: pendingHint });
          pendingHint = undefined;
        }
        return;
      }

      if (typed.type === "ping" && typed.ping_event) {
        const delay = typed.ping_event.ping_ms ?? 0;
        setTimeout(() => {
          if (socket.readyState === SOCKET_OPEN) {
            socket.send(JSON.stringify({ type: "pong", event_id: typed.ping_event!.event_id }));
          }
        }, delay);
        return;
      }

      if (typed.type === "audio") {
        if (muteAgent) return;
        const event = typed.audio_event as { audio_base_64?: string; audio_base64?: string } | undefined;
        const payload = event?.audio_base_64 ?? event?.audio_base64 ?? typed.audio?.chunk;
        if (payload && (streamSid || phones.length > 0)) {
          sendAgentAudio(payload);
        }
        return;
      }

      const transcriptText =
        (message as { user_transcription_event?: { user_transcript?: string } })
          .user_transcription_event?.user_transcript ??
        (message as { tentative_user_transcription_event?: { user_transcript?: string } })
          .tentative_user_transcription_event?.user_transcript;
      const transcriptPartial = typed.type === "tentative_user_transcript";

      if (typed.type === "user_transcript" || typed.type === "tentative_user_transcript") {
        const t = transcriptText;
        if (t) {
          if (handedOff) {
            emitHelperSpeech(callCtx, tag, t, transcriptPartial);
            return;
          }
          if (transcriptPartial) return;
          callLog(tag, "user", t);
          if (!callCtx.patientId) {
            const previousAgent = [...(callCtx.transcript ?? [])].reverse().find(turn => turn.speaker === "agent")?.text;
            const identity = spokenIdentity(t, previousAgent);
            if (identity) {
              Object.assign(callCtx, identity);
              background(callCtx.audit?.("patient.identified", identity) ?? Promise.resolve());
            }
          }
          if (!callCtx.motive && substantive(t)) callCtx.motive = motiveFrom(t);
          background(callCtx.audit?.("conversation.user", { text: t }) ?? Promise.resolve());
          callCtx.transcript = [
            ...(callCtx.transcript ?? []),
            { speaker: "caller" as const, text: t },
          ].slice(-12);
          const language = transcriptLanguage(t);
          sendMonitor({ type: "user", text: t, language });
          if (language && language !== lastDetectedLanguage) {
            lastDetectedLanguage = language;
            sendEleven({
              type: "contextual_update",
              context_id: "detected-language",
              text:
                language === "es"
                  ? "The caller is speaking Spanish. Reply only in Spanish. Never say 'one moment' or any English filler."
                  : "The caller is speaking English. Reply only in English.",
            });
          }
          if (isPauseTranscript(t)) {
            muteAgent = true;
            sendEleven({
              type: "contextual_update",
              text: "That was a pause, not speech. Stay silent. Do not ask if they are still there.",
            });
          } else {
            muteAgent = false;
            callCtx.userTurns = (callCtx.userTurns ?? 0) + 1;
            const decision = routeFor(t);
            callCtx.route = decision.route;
            callCtx.intent = decision.intent;
            callCtx.frustrationScore = Math.min(
              100,
              (callCtx.frustrationScore ?? 0) + frustrationDelta(t),
            );
            emitCallEvent("route.decided", callCtx.callId, callCtx.configVersion ?? "defaults", {
              ...decision,
              mode: callCtx.routingMode ?? "shadow",
              frustrationScore: callCtx.frustrationScore,
            });
            if (
              callCtx.routingMode === "enforce" &&
              callCtx.frustrationScore >= (callCtx.frustrationThreshold ?? 75) &&
              decision.route !== "human"
            ) {
              callCtx.route = "human";
              sendEleven({
                type: "contextual_update",
                text: "The caller is frustrated. Offer to pass the call to the human team now.",
              });
            }
          }
        }
      }
      if (typed.type === "agent_response") {
        const t = (message as { agent_response_event?: { agent_response?: string } })
          .agent_response_event?.agent_response;
        if (t) {
          callLog(tag, "agent", t);
          background(callCtx.audit?.("conversation.agent", { text: t }) ?? Promise.resolve());
          if (!handedOff && /un momento, por favor|i will transfer|please hold/i.test(t)) {
            muteAgent = true;
          }
          callCtx.transcript = [
            ...(callCtx.transcript ?? []),
            { speaker: "agent" as const, text: t },
          ].slice(-12);
          sendMonitor({ type: "agent", text: t, language: transcriptLanguage(t) });
          if (!handedOff && isNudgeSpeech(t)) muteAgent = true;
        }
      }

      const toolCall = extractClientToolCall(message);
      if (toolCall) {
        toolCalls += 1;
        callLog(tag, "tool", toolCall.tool_name, toolCall.parameters);
        sendMonitor({
          type: "tool",
          toolCallId: toolCall.tool_call_id,
          name: toolCall.tool_name,
          params: toolCall.parameters,
        });
        const toolAudit = { toolCallId: toolCall.tool_call_id, toolName: toolCall.tool_name };
        background(callCtx.audit?.("tool.received", { ...toolAudit, parameters: toolCall.parameters }) ?? Promise.resolve());
        if (toolCall.tool_name === "end_call") {
          sendMonitor({ type: "tool_result", toolCallId: toolCall.tool_call_id, name: toolCall.tool_name, result: JSON.stringify({ error: "El paciente controla el cierre de la llamada." }) });
          callLog(tag, "blocked end_call");
          background(callCtx.audit?.("tool.blocked", { ...toolAudit, reason: "caller_controls_hangup" }) ?? Promise.resolve());
          if (socket.readyState === SOCKET_OPEN) {
            socket.send(
              JSON.stringify({
                type: "client_tool_result",
                tool_call_id: toolCall.tool_call_id,
                result:
                  "Stay on the line. Do not hang up. Wait silently for the caller to end the call.",
                is_error: false,
              }),
            );
          }
          return;
        }
        if (actionToolBlocked(callCtx, toolCall.tool_name)) {
          sendMonitor({ type: "tool_result", toolCallId: toolCall.tool_call_id, name: toolCall.tool_name, result: JSON.stringify({ error: "Esta acción está deshabilitada para la organización." }) });
          background(callCtx.audit?.("tool.blocked", { ...toolAudit, reason: "action_tools_disabled" }) ?? Promise.resolve());
          socket.send(
            JSON.stringify({
              type: "client_tool_result",
              tool_call_id: toolCall.tool_call_id,
              result: "Action tools are disabled for this organisation. Offer human assistance.",
              is_error: true,
            }),
          );
          return;
        }
        const toolStarted = Date.now();
        pendingTools += 1;
        const task = (async () => {
          await callCtx.audit?.("tool.called", { ...toolAudit, parameters: toolCall.parameters });
          return withAuditContext(toolAudit, () => runClinicTool(callCtx, toolCall.tool_name, toolCall.parameters));
        })()
          .then(async (result) => {
            callLog(tag, "tool result", toolCall.tool_name, result.slice(0, 800));
            sendMonitor({
              type: "tool_result",
              toolCallId: toolCall.tool_call_id,
              name: toolCall.tool_name,
              result: result.slice(0, 4_000),
            });
            if (socket.readyState === SOCKET_OPEN) {
              socket.send(
                JSON.stringify({
                  type: "client_tool_result",
                  tool_call_id: toolCall.tool_call_id,
                  result,
                  is_error: false,
                }),
              );
              if (!options.demo && toolCall.tool_name === "submit_escalate" && !result.includes('"error"')) {
                sendEleven({
                  type: "contextual_update",
                  text: "Say one short sentence: Le paso con una compañera. Then stay silent.",
                });
                sendMonitor({ type: "handoff_ready" });
                setTimeout(() => {
                  if (!handedOff) muteAgent = true;
                }, 4_500);
              } else if (toolCall.tool_name.startsWith("submit_") && !result.includes('"error"')) {
                socket.send(
                  JSON.stringify({
                    type: "contextual_update",
                    text: options.demo ? "Rehearsal action only. Explain the simulated outcome briefly; no real appointment or transfer was made." : "Record submitted. Confirm in one sentence if you have not. Stay silent. Do not say goodbye.",
                  }),
                );
              }
            }
            const failed = result.includes('"error"');
            if (!failed && typeof toolCall.parameters.location_id === "string") {
              site = toolCall.parameters.location_id;
            }
            if (toolCall.tool_name === "submit_escalate" && !failed) {
              const handoff = {
                reason: callCtx.outcomeReason ?? toolCall.parameters.reason ?? "out_of_scope",
                fromNumber: callCtx.fromNumber ?? null,
                patient: {
                  id: callCtx.patientId ?? null,
                  name: callCtx.patientName ?? null,
                  insurer: callCtx.insurer ?? null,
                },
                intent: callCtx.intent ?? null,
                frustrationScore: callCtx.frustrationScore ?? 0,
                transcript: callCtx.zeroRetention ? [] : (callCtx.transcript ?? []),
              };
              emitCallEvent(
                "handoff.prepared",
                callCtx.callId,
                callCtx.configVersion ?? "defaults",
                handoff,
              );
              sendMonitor({ type: "handoff", ...handoff });
            }
            if (failed) {
              toolErrors += 1;
              callCtx.failureCount = (callCtx.failureCount ?? 0) + 1;
              callCtx.frustrationScore = Math.min(100, (callCtx.frustrationScore ?? 0) + 15);
            }
            let resultData: unknown;
            try { resultData = JSON.parse(result); } catch { resultData = { text: result }; }
            await callCtx.audit?.("tool.completed", {
              ...toolAudit,
              result: resultData,
              ok: !failed,
              latencyMs: Date.now() - toolStarted,
              failureCount: callCtx.failureCount ?? 0,
            });
            if ((callCtx.failureCount ?? 0) >= (callCtx.escalationFails ?? 3)) {
              callCtx.route = "human";
              sendEleven({
                type: "contextual_update",
                text: "The configured failure limit was reached. Offer the human team; do not retry the same action.",
              });
            }
          })
          .catch(async (error: unknown) => {
            sendMonitor({ type: "error", toolCallId: toolCall.tool_call_id, text: "La herramienta no pudo completar la operación.", name: toolCall.tool_name });
            toolErrors += 1;
            callCtx.failureCount = (callCtx.failureCount ?? 0) + 1;
            callLogError(tag, "tool error", toolCall.tool_name, error);
            await callCtx.audit?.("tool.failed", {
              ...toolAudit,
              errorType: error instanceof Error ? error.name : "UnknownError",
              latencyMs: Date.now() - toolStarted,
            });
            if (socket.readyState === SOCKET_OPEN) {
              socket.send(
                JSON.stringify({
                  type: "client_tool_result",
                  tool_call_id: toolCall.tool_call_id,
                  result: error instanceof Error ? error.message : "tool failed",
                  is_error: true,
                }),
              );
            }
          })
          .finally(() => {
            pendingTools = Math.max(0, pendingTools - 1);
          });
        toolTasks.add(task);
        background(task.finally(() => toolTasks.delete(task)));
      }
    });
    socket.on("close", (code, reason) => {
      callLog(tag, "elevenlabs closed", code, reason.toString());
      background(callCtx.audit?.("voice.disconnected", { provider: "elevenlabs", code }) ?? Promise.resolve());
      if (eleven === socket) {
        eleven = undefined;
        elevenReady = false;
        keepTwilioAlive();
      }
      if (!stopped && hostStillNeeded() && elevenReconnects < 3) {
        elevenReconnects += 1;
        callLog(tag, "reconnect eleven for live handoff", elevenReconnects);
        if (connectEleven) background(connectEleven());
        return;
      }
      background(finish(callCtx));
    });
    socket.on("error", (error) => {
      callLogError(tag, "elevenlabs ws", error);
      background(callCtx.audit?.("voice.error", { provider: "elevenlabs", errorType: error.name }) ?? Promise.resolve());
    });
  };

  twilio.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    let message: TwilioMessage;
    try {
      message = JSON.parse(text) as TwilioMessage;
    } catch {
      return;
    }

    if (message.event === "connected") {
      callLog("stream connected");
      return;
    }

    if (message.event === "start") {
      if (ctx || joinedHost || stopped) return;
      const start = message as TwilioStart;
      if (!start.start?.streamSid || !start.start.callSid) {
        twilio.close(1008, "Invalid start event");
        return;
      }
      streamSid = start.start.streamSid;
      const params = start.start.customParameters ?? {};
      callLog("stream start", start.start.callSid, JSON.stringify(params));
      const joinId = params.join ?? params["Join"] ?? pathJoin.joinId;
      if (joinId) {
        const host = getLiveSession(joinId);
        if (host) {
          host.addPhone(twilio, streamSid);
          joinedHost = host;
          markPhoneJoined(joinId);
          callLog("phone joined live agent", joinId);
          return;
        }
        twilio.close(1008, "Live call not found");
        return;
      }
      if (options.joinOnly) {
        twilio.close(1008, "Expected live call join");
        return;
      }
      const callId = start.start.customParameters?.call_id || start.start.callSid;
      const fromNumber = start.start.customParameters?.from_number;
      const orgSlug = start.start.customParameters?.org_slug || pathJoin.orgSlug || "arenal";
      const clinicName = clinicNameFor(orgSlug);
      simulationMode = start.start.customParameters?.simulation != null;
      const client = new PlatformClient(undefined, undefined, async (type, payload) => {
        await callCtx.audit?.(type, payload);
      });
      const platform = options.demo ? new Proxy(client, {
        get(target, key) {
          if (typeof key === "string" && key.startsWith("submit")) return async () => ({
            accepted: true, simulated: true, action: key,
            message: "Ensayo: acción simulada, no se ha modificado la agenda real.",
          });
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) : client;
      const callCtx: CallContext = fromNumber
        ? { callId, fromNumber, platform, simulationMode, twilioCallSid: start.start.callSid, orgSlug, handoffUrl: options.handoffUrl, liveBridge: bridge, waitUntil: background }
        : { callId, platform, simulationMode, twilioCallSid: start.start.callSid, orgSlug, handoffUrl: options.handoffUrl, liveBridge: bridge, waitUntil: background };
      callCtx.audit = async (type, payload) => {
        await emitCallEvent(type, callId, callCtx.configVersion ?? "defaults", {
          ...currentAuditContext(), ...payload, orgSlug, zeroRetention: callCtx.zeroRetention ?? true,
        });
      };
      ctx = callCtx;
      callCtx.demo = options.demo ?? false;
      durationTimer = setTimeout(() => {
        stopped = true;
        background(finish(callCtx));
        eleven?.close();
        twilio.close(1000, "Maximum call duration reached");
      }, 30 * 60 * 1_000);
      startedAt = Date.now();
      callLog("call start", callId, fromNumber ?? "withheld");
      registerLiveSession({
        callId,
        audit: async (type, payload) => { await callCtx.audit?.(type, payload); },
        sendElevenAudio: (ulaw) => {
          if (elevenReady && eleven?.readyState === SOCKET_OPEN) {
            sendEleven({ user_audio_chunk: ulaw });
          } else {
            queueAudio(ulaw);
          }
        },
        sendToCaller: (ulaw) => {
          if (streamSid && twilio.readyState === SOCKET_OPEN) {
            sendTwilio({ event: "media", streamSid, media: { payload: ulaw } });
          }
        },
        addPhone: (ws, sid) => {
          phones.push({ ws, streamSid: sid });
          markPhoneJoined(callId);
          muteAgent = false;
          handedOff = true;
          background(callCtx.audit?.("handoff.phone.joined", { streamSid: sid }) ?? Promise.resolve());
          sendMonitor({ type: "helper_joined" });
          if (!patientAnnounced) {
            announceSimulatedPatient();
            sendEleven({ type: "user_message", text: PATIENT_SPEECH });
            sendEleven({
              type: "contextual_update",
              text: "The patient is now speaking on the live phone. Continue the booking in Spanish. If they accept the offered time, take the slot. Speak. Do not stay silent.",
            });
          }
        },
        removePhone: (ws) => {
          const index = phones.findIndex((phone) => phone.ws === ws);
          if (index >= 0) {
            phones.splice(index, 1);
            background(callCtx.audit?.("handoff.phone.left", {}) ?? Promise.resolve());
            finishIfUnused();
          }
        },
        freezeDisplay: () => {
          sendMonitor({ type: "helper_joined" });
        },
      });

      const wallClock = setTimeout(() => {
        background((async () => {
          try {
            await flushPendingSubmit(callCtx);
            if (callCtx.submitted) callLog(callId.slice(0, 8), "flushed book on wall-clock");
          } catch (error: unknown) {
            callLogError(callId.slice(0, 8), "wall-clock flush failed", error);
          }
          if (callCtx.submitted || !callCtx.lastDecline) return;
          callLogWarn(callId.slice(0, 8), "wall-clock submit", callCtx.lastDecline);
          await runClinicTool(callCtx, "submit_no_action", { reason: callCtx.lastDecline }).catch(
            (error: unknown) => {
              callLogError(callId.slice(0, 8), "wall-clock submit failed", error);
            },
          );
        })());
      }, 165_000);

      twilio.once("close", () => {
        clearTimeout(wallClock);
        stopHold();
      });

      playHold();
      background((async () => {
        const runtime = await loadRuntimeConfig(orgSlug);
        Object.assign(callCtx, {
          configVersion: runtime.version,
          routingMode: runtime.routingMode,
          actionTools: runtime.actionTools,
          postCallWebhook: runtime.postCallWebhook || Boolean(runtime.postCallEndpoint),
          postCallEndpoint: runtime.postCallEndpoint,
          zeroRetention: runtime.zeroRetention,
          escalationFails: runtime.escalationFails,
          frustrationThreshold: runtime.frustrationThreshold,
          failureCount: 0,
          frustrationScore: 0,
        });
        await callCtx.audit?.("call.started", {
          hasFromNumber: Boolean(fromNumber), routingMode: runtime.routingMode,
        });
        const emptyPreCall: PreCallContext = {
          hint: "",
          patientName: "",
          insurer: "",
          patientId: "",
        };
        const preCallStarted = Date.now();
        const preCall =
          runtime.patientLookup && fromNumber
            ? await Promise.race([
                lookupByPhone(platform, fromNumber),
                new Promise<PreCallContext>((resolve) =>
                  setTimeout(() => resolve(emptyPreCall), 550),
                ),
              ])
            : emptyPreCall;
        let externalContext = "";
        if (runtime.preCallEndpoint && !options.demo) {
          try {
            await callCtx.audit?.("context.requested", { endpoint: runtime.preCallEndpoint });
            const response = await fetch(runtime.preCallEndpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ call_id: callId, from_number: fromNumber ?? "" }),
              signal: AbortSignal.timeout(550),
            });
            if (response.ok) externalContext = (await response.text()).slice(0, 4_000);
            await callCtx.audit?.("context.completed", { status: response.status });
          } catch {
            await callCtx.audit?.("context.failed", {});
            externalContext = "";
          }
        }
        callCtx.knownPatient = Boolean(preCall.patientId);
        callCtx.patientName = preCall.patientName;
        callCtx.patientId = preCall.patientId;
        callCtx.insurer = preCall.insurer;
        emitCallEvent("crm.lookup.completed", callId, runtime.version, {
          ...summaryIdentity(preCall),
          matched: Boolean(preCall.patientId),
          latencyMs: Date.now() - preCallStarted,
        });
        if (preCall.hint) callLog("directory hint", callId, preCall.hint.slice(0, 200));
        connectEleven = async () => {
          while (!stopped && (twilio.readyState === SOCKET_OPEN || hostStillNeeded()) && !elevenReady) {
            try {
              const url = await getSignedConversationUrl(callCtx.audit);
              await callCtx.audit?.("voice.connecting", { provider: "elevenlabs" });
              const socket = await options.connect(url);
              if (stopped || (twilio.readyState !== SOCKET_OPEN && !hostStillNeeded())) {
                socket.close();
                return;
              }
              await callCtx.audit?.("voice.connected", { provider: "elevenlabs" });
              stopHold();
              attachEleven(socket, callCtx);
              socket.send(
                JSON.stringify({
                  type: "conversation_initiation_client_data",
                  conversation_config_override: {
                    ...conversationConfigOverride(options.demo ? { ...runtime, language: "es",
                      firstMessage: runtime.language === "es" ? runtime.firstMessage : "{{clinic_name}}, buenos días. ¿En qué puedo ayudarle?" } : runtime),
                    ...(options.textOnly ? { conversation: { text_only: true } } : {}),
                  },
                  dynamic_variables: {
                    call_id: callId,
                    from_number: fromNumber ?? "",
                    madrid_today: madridToday(),
                    directory_hint: runtime.dynamicContext ? preCall.hint : "",
                    patient_name: runtime.dynamicContext ? preCall.patientName : "",
                    insurer: runtime.dynamicContext ? preCall.insurer : "",
                    patient_id: runtime.dynamicContext ? preCall.patientId : "",
                    config_version: runtime.version,
                    routing_mode: runtime.routingMode,
                    hospital_context: externalContext,
                    approved_faq: JSON.stringify(runtime.faq).slice(0, 8_000),
                    clinic_name: clinicName,
                    meta_prompt: runtime.metaPrompt,
                    org_instructions: runtime.extraInstructions,
                    desk_rules: applyAgentPrompt(runtime),
                  },
                }),
              );
              elevenReady = true;
              flushAudio();
              return;
            } catch (error: unknown) {
              await callCtx.audit?.("voice.connection.failed", { provider: "elevenlabs", errorType: error instanceof Error ? error.name : "UnknownError" });
              callLogError("elevenlabs retry", callId, error);
              await new Promise((resolve) => setTimeout(resolve, 800));
            }
          }
        };
        await connectEleven();
      })().catch((error: unknown) => {
        stopHold();
        twilio.close(1011, "Call initialization failed");
        throw error;
      }));
      return;
    }

    if (message.event === "media") {
      const media = message as TwilioMedia;
      const payload = media.media.payload;
      if (joinedHost) {
        joinedHost.sendElevenAudio(payload);
        return;
      }
      if (elevenReady && eleven?.readyState === SOCKET_OPEN) {
        sendEleven({ user_audio_chunk: payload });
      } else {
        queueAudio(payload);
      }
      return;
    }

    if (message.event === "user_text") {
      const spoken = String((message as { text?: string }).text ?? "").trim();
      if (handedOff && ctx) {
        emitHelperSpeech(ctx, ctx.callId.slice(0, 8), spoken);
        return;
      }
      const callCtx = ctx;
      if (!spoken || !callCtx) return;
      let tries = 0;
      const deliver = () => {
        if (tries++ > 25) return;
        if (!elevenReady || eleven?.readyState !== SOCKET_OPEN) {
          setTimeout(deliver, 400);
          return;
        }
        callLog(callCtx.callId.slice(0, 8), "user", spoken);
        background(callCtx.audit?.("conversation.user", { text: spoken, source: "simulator" }) ?? Promise.resolve());
        sendMonitor({ type: "user", text: spoken, language: transcriptLanguage(spoken) });
        callCtx.userTurns = (callCtx.userTurns ?? 0) + 1;
        sendEleven({ type: "user_message", text: spoken });
      };
      deliver();
      return;
    }

    if (message.event === "stop") {
      if (joinedHost) {
        joinedHost.removePhone(twilio);
        joinedHost = undefined;
        stopped = true;
        return;
      }
      sourceEnded();
    }
  });

  twilio.on("close", () => {
    if (joinedHost) {
      joinedHost.removePhone(twilio);
      joinedHost = undefined;
      stopped = true;
      return;
    }
    if (!ctx) stopped = true;
    sourceEnded();
  });
}
