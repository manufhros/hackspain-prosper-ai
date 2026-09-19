import { PlatformClient } from "../platform/client.ts";
import type { CallContext } from "../clinic/tools.ts";
import { Conversation } from "../voice/conversation.ts";
import { FIRST_MESSAGE } from "../voice/prompt.ts";
import { transcribeUtterance } from "../voice/stt.ts";
import { speakToMuLawFrames } from "../voice/tts.ts";
import { MULAW_SILENCE_FRAME, decodeMuLaw } from "./audio.ts";
import { Vad } from "./vad.ts";

type TwilioEvent = {
  event: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: { payload: string };
};

/** Twilio espera un frame cada 20 ms. */
const FRAME_MS = 20;

export type Socket = { send: (data: string) => void };

/**
 * Misma envoltura de Twilio que la rama de Lucía (start/media/stop sobre WS),
 * pero en lugar de reenviar el audio a ElevenLabs, lo procesamos aquí:
 * VAD → STT → LLM con tools → TTS → mu-law de vuelta.
 */
export class TwilioSession {
  private streamSid: string | null = null;
  private conversation: Conversation | null = null;
  private ctx: CallContext | null = null;
  private readonly vad = new Vad();
  private busy = false;
  private playing = false;
  private playGeneration = 0;
  private closed = false;
  private hintReady: Promise<void> | null = null;

  constructor(private readonly ws: Socket) {}

  async onMessage(raw: string | Buffer): Promise<void> {
    if (this.closed) return;
    let msg: TwilioEvent;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as TwilioEvent;
    } catch {
      return;
    }

    if (msg.event === "start") {
      this.streamSid = msg.start?.streamSid ?? msg.streamSid ?? null;
      const callId = msg.start?.customParameters?.call_id ?? msg.start?.callSid ?? "";
      const fromNumber = msg.start?.customParameters?.from_number ?? null;
      const platform = new PlatformClient();
      this.ctx = {
        callId,
        fromNumber,
        platform,
        submitted: null,
        onTool: (name, input, output) =>
          console.log(tag(callId), "tool", name, JSON.stringify(input), output.slice(0, 300)),
      };
      console.log("call start", callId, fromNumber ?? "withheld");
      const conversation = new Conversation(this.ctx, "");
      this.conversation = conversation;
      // Saluda YA. Cualquier espera aquí es silencio en la línea y el harness
      // lo marca como agent_silence.
      void this.say(FIRST_MESSAGE);
      this.hintReady = lookupByPhone(platform, fromNumber).then((hint) => {
        conversation.setDirectoryHint(hint);
      });
      return;
    }

    if (msg.event === "media" && msg.media?.payload) {
      this.onAudio(msg.media.payload);
      return;
    }

    if (msg.event === "stop") {
      console.log("call stop", this.ctx?.callId, this.conversation?.needsTerminalAction ? "SIN SUBMIT" : "");
      this.close();
    }
  }

  close(): void {
    this.closed = true;
    this.playGeneration += 1;
  }

  private onAudio(b64: string): void {
    const pcm = decodeMuLaw(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const event = this.vad.push(pcm, this.playing);

    if (event.type === "barge-in") {
      // Nos han interrumpido: cortamos nuestro audio y escuchamos.
      this.playGeneration += 1;
      this.playing = false;
      this.vad.reset();
      return;
    }
    if (event.type === "utterance" && !this.busy) {
      void this.handleUtterance(event.pcm);
    }
  }

  private async handleUtterance(pcm: Int16Array): Promise<void> {
    if (!this.conversation || this.busy) return;
    this.busy = true;
    const tagged = tag(this.ctx?.callId ?? "");
    try {
      const text = await transcribeUtterance(pcm);
      if (!text) return;
      await this.hintReady; // resuelto hace rato; solo garantiza el orden
      console.log(tagged, "user", text);
      const reply = await this.conversation.respond(text);
      console.log(tagged, "agent", reply);
      if (reply) await this.say(reply);
    } catch (error) {
      console.error(tagged, "turn failed", error);
      // Nunca dejes la línea muda: el harness lo marca como agent_silence.
      await this.say("Perdone, ¿me lo puede repetir?");
    } finally {
      this.busy = false;
    }
  }

  private async say(text: string): Promise<void> {
    let frames: Uint8Array[];
    try {
      frames = await speakToMuLawFrames(text);
    } catch (error) {
      console.error("tts failed", error);
      return;
    }
    const generation = ++this.playGeneration;
    this.playing = true;
    for (const frame of frames) {
      if (this.closed || generation !== this.playGeneration) break;
      this.sendFrame(frame);
      await sleep(FRAME_MS);
    }
    if (generation === this.playGeneration) this.playing = false;
  }

  private sendFrame(frame: Uint8Array): void {
    if (this.closed || !this.streamSid) return;
    this.ws.send(
      JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: { payload: base64(frame) },
      }),
    );
  }

  /** Silencio de cortesía mientras pensamos, para que la línea no parezca caída. */
  keepAlive(): void {
    if (!this.playing && this.busy) this.sendFrame(MULAW_SILENCE_FRAME);
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tag(callId: string): string {
  return callId.slice(0, 8);
}

async function lookupByPhone(
  platform: PlatformClient,
  fromNumber: string | null,
): Promise<string> {
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
