import { CaptureFrames } from './audio.js';
class ReceptionCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capture = new CaptureFrames(sampleRate, frame => this.port.postMessage(frame, [frame.buffer]));
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) this.capture.push(samples);
    // Output stays silent: the microphone must never loop into the speakers.
    return true;
  }
}
registerProcessor('reception-capture', ReceptionCapture);
