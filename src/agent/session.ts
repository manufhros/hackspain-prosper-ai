import { WebSocket } from "ws";
import { PlatformClient } from "../platform/client.ts";
import { extractClientToolCall, getSignedConversationUrl } from "./elevenlabs.ts";
import { clinicTodayYmd, runClinicTool, type CallContext } from "./tools.ts";

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

const MAX_PENDING = 250;
const MULAW_SILENCE = Buffer.alloc(160, 0xff).toString("base64");

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
      })),
    );
  } catch (error) {
    console.error("directory hint", error);
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

  const keepTwilioAlive = () => {
    if (holdTimer || twilio.readyState !== WebSocket.OPEN || !streamSid) return;
    holdTimer = setInterval(() => {
      if (twilio.readyState !== WebSocket.OPEN || !streamSid) {
        stopHold();
        return;
      }
      sendTwilio({ event: "media", streamSid, media: { payload: MULAW_SILENCE } });
    }, 20);
  };

  const closeElevenSoon = () => {
    stopHold();
    const wait = pendingTools > 0 ? 8000 : 5000;
    setTimeout(() => eleven?.close(), wait);
  };

  const attachEleven = (socket: WebSocket, callCtx: CallContext) => {
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
        console.log(tag, "eleven", typed.type);
      }

      if (typed.type === "conversation_initiation_metadata") {
        elevenReady = true;
        flushAudio();
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
        const payload = typed.audio_event?.audio_base_64 ?? typed.audio?.chunk;
        if (payload && streamSid) {
          sendTwilio({ event: "media", streamSid, media: { payload } });
        }
        return;
      }

      if (typed.type === "user_transcript") {
        const t = (message as { user_transcription_event?: { user_transcript?: string } })
          .user_transcription_event?.user_transcript;
        if (t) console.log(tag, "user", t);
      }
      if (typed.type === "agent_response") {
        const t = (message as { agent_response_event?: { agent_response?: string } })
          .agent_response_event?.agent_response;
        if (t) console.log(tag, "agent", t);
      }

      const toolCall = extractClientToolCall(message);
      if (toolCall) {
        console.log(tag, "tool", toolCall.tool_name, toolCall.parameters);
        pendingTools += 1;
        void runClinicTool(callCtx, toolCall.tool_name, toolCall.parameters)
          .then((result) => {
            console.log(tag, "tool result", toolCall.tool_name, result.slice(0, 500));
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: "client_tool_result",
                  tool_call_id: toolCall.tool_call_id,
                  result,
                  is_error: false,
                }),
              );
            }
          })
          .catch((error: unknown) => {
            console.error(tag, "tool error", toolCall.tool_name, error);
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
      console.log(tag, "elevenlabs closed", code, reason.toString());
      if (eleven === socket) {
        eleven = undefined;
        elevenReady = false;
        keepTwilioAlive();
      }
    });
    socket.on("error", (error) => {
      console.error(tag, "elevenlabs ws", error);
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
      console.log("call start", callId, fromNumber ?? "withheld");

      void getSignedConversationUrl()
        .then(
          (url) =>
            new Promise<void>((resolve, reject) => {
              const socket = new WebSocket(url);
              socket.once("open", () => {
                attachEleven(socket, callCtx);
                socket.send(
                  JSON.stringify({
                    type: "conversation_initiation_client_data",
                    dynamic_variables: {
                      call_id: callId,
                      from_number: fromNumber ?? "",
                      madrid_today: madridToday(),
                      directory_hint: "",
                    },
                  }),
                );
                elevenReady = true;
                flushAudio();
                resolve();
              });
              socket.once("error", reject);
            }),
        )
        .catch((error: unknown) => {
          console.error("failed to open elevenlabs", callId, error);
        });
      void lookupByPhone(platform, fromNumber).then((hint) => {
        if (hint) console.log("directory hint", callId, hint.slice(0, 200));
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
      closeElevenSoon();
    }
  });

  twilio.on("close", () => {
    stopHold();
    closeElevenSoon();
  });
}
