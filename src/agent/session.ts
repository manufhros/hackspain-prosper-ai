import { WebSocket } from "ws";
import { PlatformClient } from "../platform/client.ts";
import { callLog, callLogError, callLogWarn } from "./call-log.ts";
import { extractClientToolCall, getSignedConversationUrl } from "./elevenlabs.ts";
import { holdFrame } from "./hold-audio.ts";
import { AGENT_PROMPT } from "./prompt.ts";
import { clinicTodayYmd, flushPendingSubmit, runClinicTool, type CallContext } from "./tools.ts";

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

async function lookupByPhone(platform: PlatformClient, fromNumber?: string): Promise<string> {
  if (!fromNumber) return "";
  try {
    const found = await platform.directory({ phone: fromNumber });
    return JSON.stringify(
      found.matches.map((match) => ({
        patient_id: match.patient_id,
        name: `${match.given_name} ${match.first_surname} ${match.second_surname}`,
        insurer: match.insurer,
        has_visited_before: match.has_visited_before,
        note: match.note,
      })),
    );
  } catch (error) {
    callLogError("directory hint", error);
    return "";
  }
}

export async function handleCall(twilio: WebSocket): Promise<void> {
  let streamSid: string | undefined;
  let ctx: CallContext | undefined;
  let eleven: WebSocket | undefined;
  let elevenReady = false;
  let pendingTools = 0;
  const pendingAudio: string[] = [];
  let holdTimer: ReturnType<typeof setInterval> | undefined;
  let holdTick = 0;
  let pendingHint: string | undefined;

  const sendEleven = (payload: unknown) => {
    if (eleven?.readyState === WebSocket.OPEN) {
      eleven.send(JSON.stringify(payload));
    }
  };

  const sendTwilio = (payload: unknown) => {
    if (twilio.readyState === WebSocket.OPEN) {
      twilio.send(JSON.stringify(payload));
    }
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
    if (holdTimer || twilio.readyState !== WebSocket.OPEN || !streamSid) return;
    holdTick = 0;
    holdTimer = setInterval(() => {
      if (twilio.readyState !== WebSocket.OPEN || !streamSid || elevenReady) {
        stopHold();
        return;
      }
      sendTwilio({ event: "media", streamSid, media: { payload: holdFrame(holdTick) } });
      holdTick += 1;
    }, 20);
  };

  const keepTwilioAlive = () => {
    playHold();
  };

  const closeElevenSoon = () => {
    stopHold();
    const wait = pendingTools > 0 ? 8000 : 5000;
    setTimeout(() => eleven?.close(), wait);
  };

  const isPauseTranscript = (text: string) =>
    /^\.{2,}$/i.test(text.trim()) || /^(um+|uh+|hmm+|mhm+|mm+)\.?$/i.test(text.trim());

  const isNudgeSpeech = (text: string) =>
    /still there|anyone there|can you hear me|if you are there|whenever you are ready to speak/i.test(
      text,
    );

  const attachEleven = (socket: WebSocket, callCtx: CallContext) => {
    eleven = socket;
    const tag = callCtx.callId.slice(0, 8);
    let muteAgent = false;
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
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "pong", event_id: typed.ping_event!.event_id }));
          }
        }, delay);
        return;
      }

      if (typed.type === "audio") {
        if (muteAgent) return;
        const event = typed.audio_event as { audio_base_64?: string; audio_base64?: string } | undefined;
        const payload = event?.audio_base_64 ?? event?.audio_base64 ?? typed.audio?.chunk;
        if (payload && streamSid) {
          sendTwilio({ event: "media", streamSid, media: { payload } });
        }
        return;
      }

      if (typed.type === "user_transcript") {
        const t = (message as { user_transcription_event?: { user_transcript?: string } })
          .user_transcription_event?.user_transcript;
        if (t) {
          callLog(tag, "user", t);
          if (isPauseTranscript(t)) {
            muteAgent = true;
            sendEleven({
              type: "contextual_update",
              text: "That was a pause, not speech. Stay silent. Do not ask if they are still there.",
            });
          } else {
            muteAgent = false;
            callCtx.userTurns = (callCtx.userTurns ?? 0) + 1;
          }
        }
      }
      if (typed.type === "agent_response") {
        const t = (message as { agent_response_event?: { agent_response?: string } })
          .agent_response_event?.agent_response;
        if (t) {
          callLog(tag, "agent", t);
          if (isNudgeSpeech(t)) muteAgent = true;
        }
      }

      const toolCall = extractClientToolCall(message);
      if (toolCall) {
        callLog(tag, "tool", toolCall.tool_name, toolCall.parameters);
        if (toolCall.tool_name === "end_call") {
          callLog(tag, "blocked end_call");
          if (socket.readyState === WebSocket.OPEN) {
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
        pendingTools += 1;
        void runClinicTool(callCtx, toolCall.tool_name, toolCall.parameters)
          .then((result) => {
            callLog(tag, "tool result", toolCall.tool_name, result.slice(0, 800));
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: "client_tool_result",
                  tool_call_id: toolCall.tool_call_id,
                  result,
                  is_error: false,
                }),
              );
              if (toolCall.tool_name.startsWith("submit_") && !result.includes('"error"')) {
                socket.send(
                  JSON.stringify({
                    type: "contextual_update",
                    text: "Record submitted. Confirm in one sentence if you have not. Stay silent. Do not say goodbye.",
                  }),
                );
              }
            }
          })
          .catch((error: unknown) => {
            callLogError(tag, "tool error", toolCall.tool_name, error);
            if (socket.readyState === WebSocket.OPEN) {
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
      }
    });
    socket.on("close", (code, reason) => {
      callLog(tag, "elevenlabs closed", code, reason.toString());
      void flushPendingSubmit(callCtx)
        .then(() => {
          if (callCtx.submitted) callLog(tag, "flushed book on eleven close");
        })
        .catch((error: unknown) => {
          callLogError(tag, "flush on eleven close failed", error);
        });
      if (eleven === socket) {
        eleven = undefined;
        elevenReady = false;
        keepTwilioAlive();
      }
    });
    socket.on("error", (error) => {
      callLogError(tag, "elevenlabs ws", error);
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

    if (message.event === "start") {
      const start = message as TwilioStart;
      streamSid = start.start.streamSid;
      const callId = start.start.customParameters?.call_id || start.start.callSid;
      const fromNumber = start.start.customParameters?.from_number;
      const platform = new PlatformClient();
      const callCtx: CallContext = fromNumber
        ? { callId, fromNumber, platform }
        : { callId, platform };
      ctx = callCtx;
      callLog("call start", callId, fromNumber ?? "withheld");

      const wallClock = setTimeout(() => {
        void (async () => {
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
        })();
      }, 165_000);

      twilio.once("close", () => {
        clearTimeout(wallClock);
        stopHold();
      });

      playHold();
      void (async () => {
        while (twilio.readyState === WebSocket.OPEN && !elevenReady) {
          try {
            const url = await getSignedConversationUrl();
            await new Promise<void>((resolve, reject) => {
              const socket = new WebSocket(url);
              const timer = setTimeout(() => {
                socket.close();
                reject(new Error("elevenlabs ws timeout"));
              }, 12_000);
              socket.once("open", () => {
                clearTimeout(timer);
                stopHold();
                attachEleven(socket, callCtx);
                socket.send(
                  JSON.stringify({
                    type: "conversation_initiation_client_data",
                    dynamic_variables: {
                      call_id: callId,
                      from_number: fromNumber ?? "",
                      madrid_today: madridToday(),
                      directory_hint: "",
                      desk_rules: AGENT_PROMPT,
                    },
                  }),
                );
                elevenReady = true;
                flushAudio();
                resolve();
              });
              socket.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
              });
            });
            return;
          } catch (error: unknown) {
            callLogError("elevenlabs retry", callId, error);
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      })();
      const pushHint = (hint: string) => {
        callCtx.knownPatient = hint.includes("patient_id");
        callLog("directory hint", callId, hint.slice(0, 200));
        const text = `Phone directory match: ${hint}. After they say what they need, search_directory with phone ${fromNumber ?? ""}, confirm this name, then search_availability. Do not ask them to spell the name first.`;
        if (elevenReady && eleven?.readyState === WebSocket.OPEN) {
          sendEleven({ type: "contextual_update", text });
        } else {
          pendingHint = text;
        }
      };
      void lookupByPhone(platform, fromNumber).then((hint) => {
        if (hint) pushHint(hint);
      });
      return;
    }

    if (message.event === "media") {
      const media = message as TwilioMedia;
      const payload = media.media.payload;
      if (elevenReady && eleven?.readyState === WebSocket.OPEN) {
        sendEleven({ user_audio_chunk: payload });
      } else {
        queueAudio(payload);
      }
      return;
    }

    if (message.event === "stop") {
      stopHold();
      if (ctx) {
        void flushPendingSubmit(ctx).catch((error: unknown) => {
          callLogError(ctx.callId.slice(0, 8), "flush on stop failed", error);
        });
      }
      closeElevenSoon();
    }
  });

  twilio.on("close", () => {
    stopHold();
    if (ctx) {
      void flushPendingSubmit(ctx).catch((error: unknown) => {
        callLogError(ctx.callId.slice(0, 8), "flush on close failed", error);
      });
    }
    closeElevenSoon();
  });
}
