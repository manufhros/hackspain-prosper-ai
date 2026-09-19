import { encodeMulaw, decodeMulaw } from "./audio-codec.js";
export class BrowserVoice {
  private context?: AudioContext;
  private stream?: MediaStream;
  private socket?: WebSocket;
  private capture?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private silence?: GainNode;
  private nodes = new Set<AudioBufferSourceNode>();
  private cursor = 0;
  private stopped = false;
  constructor(
    private onStatus: (status: string) => void,
    private onCall: (id: string) => void,
    private onError: (message: string) => void,
  ) {}
  async start(getTicket: () => Promise<{ ticket: string }>) {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("El micrófono requiere HTTPS o localhost.");
      this.context = new AudioContext();
      await this.context.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.stopped) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await this.context.audioWorklet.addModule("/microphone-worklet.js");
      const { ticket } = await getTicket();
      if (this.stopped) return;
      const url = new URL("/ws/browser", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      const socket = (this.socket = new WebSocket(url));
      this.onStatus("Conectando con el agente…");
      socket.onmessage = (event) => {
        try {
          const e = JSON.parse(event.data);
          if (e.type === "ready") {
            this.onCall(e.callId);
            this.captureMicrophone();
            this.onStatus("Micrófono activo · habla cuando quieras");
          } else if (e.event === "media") this.play(e.media.payload);
          else if (e.event === "clear") this.clear();
          else if (e.type === "error")
            throw new Error(
              "El proveedor de voz ha fallado. Finaliza y vuelve a intentarlo.",
            );
        } catch (error) {
          this.onError((error as Error).message);
          this.stop();
        }
      };
      socket.onerror = () => {
        this.onError("No se pudo conectar la sesión de voz.");
        this.stop();
      };
      socket.onclose = () => {
        if (!this.stopped) {
          this.onError("La sesión de voz ha terminado.");
          this.stop();
        }
      };
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  private captureMicrophone() {
    if (this.stopped || this.capture) return;
    const ctx = this.context!;
    this.source = ctx.createMediaStreamSource(this.stream!);
    this.capture = new AudioWorkletNode(ctx, "microphone-capture");
    this.silence = ctx.createGain();
    this.silence.gain.value = 0;
    this.capture.port.onmessage = (event) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      if (this.socket.bufferedAmount > 16000) {
        this.onError("La conexión es demasiado lenta para transmitir audio.");
        this.stop();
        return;
      }
      this.socket.send(encodeMulaw(event.data as Float32Array));
    };
    this.source.connect(this.capture);
    this.capture.connect(this.silence);
    this.silence.connect(ctx.destination);
  }
  private play(payload: string) {
    const ctx = this.context!;
    const samples = decodeMulaw(
      Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
    );
    const buffer = ctx.createBuffer(1, samples.length, 8000);
    buffer.getChannelData(0).set(samples);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    this.cursor = Math.max(this.cursor, ctx.currentTime + 0.04);
    if (this.cursor - ctx.currentTime > 3)
      throw new Error("La reproducción no puede seguir el ritmo.");
    node.start(this.cursor);
    this.cursor += buffer.duration;
    this.nodes.add(node);
    node.onended = () => {
      node.disconnect();
      this.nodes.delete(node);
    };
  }
  private clear() {
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
      node.disconnect();
    }
    this.nodes.clear();
    this.cursor = 0;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.clear();
    this.capture?.disconnect();
    this.source?.disconnect();
    this.silence?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.socket?.close(1000);
    void this.context?.close();
    this.onStatus("Micrófono desconectado");
  }
}
