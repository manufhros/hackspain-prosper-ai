import { rms } from "./audio.ts";

/**
 * Detección de voz por energía. Es la pieza que ElevenLabs resolvía por
 * dentro: decidir cuándo el interlocutor ha empezado y terminado de hablar.
 *
 * Umbrales en frames de 20 ms:
 *  - SPEECH_RMS:        energía por encima de la cual consideramos que hay voz.
 *  - MIN_SPEECH_FRAMES: 200 ms de voz para no disparar con un chasquido.
 *  - SILENCE_FRAMES:    560 ms de silencio para dar el turno por cerrado.
 *  - BARGE_FRAMES:      160 ms hablando encima para cortar nuestro audio.
 */
export const SPEECH_RMS = 500;
export const MIN_SPEECH_FRAMES = 10;
export const SILENCE_FRAMES = 28;
export const BARGE_FRAMES = 8;

export type VadEvent =
  | { type: "none" }
  | { type: "barge-in" }
  | { type: "utterance"; pcm: Int16Array };

export class Vad {
  private chunks: Int16Array[] = [];
  private speechFrames = 0;
  private silenceFrames = 0;
  private inSpeech = false;
  private bargeFrames = 0;

  /** @param playing true mientras estamos reproduciendo audio nuestro. */
  push(pcm: Int16Array, playing: boolean): VadEvent {
    const level = rms(pcm);
    const loud = level > SPEECH_RMS;

    if (playing) {
      // Mientras hablamos solo nos interesa saber si nos están interrumpiendo.
      this.bargeFrames = loud ? this.bargeFrames + 1 : 0;
      if (this.bargeFrames >= BARGE_FRAMES) {
        this.bargeFrames = 0;
        return { type: "barge-in" };
      }
      return { type: "none" };
    }
    this.bargeFrames = 0;

    if (loud) {
      this.inSpeech = true;
      this.speechFrames += 1;
      this.silenceFrames = 0;
      this.chunks.push(pcm);
      return { type: "none" };
    }

    if (!this.inSpeech) return { type: "none" };

    // Silencio dentro de una frase: lo guardamos por si es una pausa corta.
    this.silenceFrames += 1;
    this.chunks.push(pcm);
    if (this.silenceFrames < SILENCE_FRAMES) return { type: "none" };

    const enough = this.speechFrames >= MIN_SPEECH_FRAMES;
    const pcmOut = enough ? concat(this.chunks) : null;
    this.reset();
    return pcmOut ? { type: "utterance", pcm: pcmOut } : { type: "none" };
  }

  reset(): void {
    this.chunks = [];
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.inSpeech = false;
    this.bargeFrames = 0;
  }
}

function concat(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
