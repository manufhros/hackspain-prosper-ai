// Average over source samples to produce continuous 8 kHz frames.
class MicrophoneCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.weight = 0;
    this.frame = new Float32Array(160);
    this.index = 0;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    const ratio = sampleRate / 8000;
    for (const value of samples) {
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, ratio - this.weight);
        this.sum += value * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= ratio - 1e-9) {
          this.frame[this.index++] = this.sum / ratio;
          this.sum = 0;
          this.weight = 0;
          if (this.index === 160) {
            this.port.postMessage(this.frame, [this.frame.buffer]);
            this.frame = new Float32Array(160);
            this.index = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("microphone-capture", MicrophoneCapture);
