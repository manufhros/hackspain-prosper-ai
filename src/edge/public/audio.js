/** G.711 mu-law, shared by the browser capture worklet and playback. */
export function encodeSample(sample) {
  let pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
  const sign = pcm < 0 ? 0x80 : 0;
  pcm = Math.min(32635, Math.abs(pcm)) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(pcm & mask); mask >>= 1) exponent--;
  return ~(sign | (exponent << 4) | ((pcm >> (exponent + 3)) & 0x0f)) & 0xff;
}
export function decodeSample(byte) {
  const value = (~byte) & 0xff;
  const magnitude = (((value & 15) << 3) + 132) << ((value & 0x70) >> 4);
  return ((value & 0x80) ? 132 - magnitude : magnitude - 132) / 32768;
}

/** Stateful weighted averaging preserves 20 ms framing at 44.1/48/96 kHz. */
export class CaptureFrames {
  constructor(rate, emit) {
    this.ratio = rate / 8000;
    this.emit = emit;
    this.weight = 0; this.sum = 0; this.offset = 0;
    this.frame = new Uint8Array(160);
  }
  push(samples) {
    for (const sample of samples) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const weight = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * weight; this.weight += weight; remaining -= weight;
        if (this.weight >= this.ratio - 1e-8) {
          this.frame[this.offset++] = encodeSample(this.sum / this.ratio);
          this.sum = 0; this.weight = 0;
          if (this.offset === 160) {
            this.emit(this.frame); this.frame = new Uint8Array(160); this.offset = 0;
          }
        }
      }
    }
  }
}

/** Single wire sequence includes both microphone frames and playback acknowledgements. */
export class KioskWire {
  constructor(send, id = crypto.randomUUID()) {
    this.send = send; this.callId = `workbench-edge-${id}`; this.streamSid = `edge-${id}`;
    this.sequence = 0; this.frames = 0;
  }
  message(event, fields = {}) {
    this.send(JSON.stringify({ event, sequenceNumber: String(++this.sequence), streamSid: this.streamSid, ...fields }));
  }
  start() {
    this.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
    this.message('start', { start: { streamSid: this.streamSid, callSid: this.callId, tracks: ['inbound'],
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 }, customParameters: { call_id: this.callId } } });
  }
  media(frame) {
    this.message('media', { media: { track: 'inbound', chunk: String(this.frames + 1), timestamp: String(this.frames * 20), payload: btoa(String.fromCharCode(...frame)) } });
    this.frames++;
  }
  mark(name) { this.message('mark', { mark: { name } }); }
}

export class Playback {
  constructor(context, onIdle) {
    this.context = context; this.onIdle = onIdle; this.next = 0;
    this.sources = new Set(); this.timers = new Set();
  }
  push(payload) {
    const bytes = atob(payload);
    if (bytes.length !== 160) throw new Error('Invalid audio frame');
    const context = this.context;
    if (context.state !== 'running' || this.next - context.currentTime > 2) throw new Error('Audio playback unavailable or behind');
    const buffer = context.createBuffer(1, bytes.length, 8000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) samples[i] = decodeSample(bytes.charCodeAt(i));
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    // Buffer once, then schedule contiguously; rebufferring every packet adds audible gaps.
    if (this.next <= context.currentTime) this.next = context.currentTime + .06;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start(this.next); this.next += buffer.duration;
  }
  mark(callback) {
    // Check audio time, not only wall time: suspended devices must not acknowledge unheard speech.
    const target = this.next;
    const check = () => {
      this.timers.delete(timer);
      if (this.context.state !== 'running') return;
      if (this.context.currentTime < target) { timer = setTimeout(check, 20); this.timers.add(timer); return; }
      callback(); if (!this.sources.size || this.next <= this.context.currentTime) this.onIdle();
    };
    let timer = setTimeout(check, Math.max(0, (target - this.context.currentTime) * 1000));
    this.timers.add(timer);
  }
  clear() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear(); this.next = 0;
  }
}
