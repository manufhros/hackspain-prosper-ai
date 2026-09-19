import { muLawSample } from "./audio";

export interface SpeechDetector { push(frame: Buffer): Promise<boolean>; reset(): void }
export type VadKernel = (input: Float32Array, state: Float32Array) => Promise<{ probability: number; state: Float32Array }>;

/** The session is shared; recurrent state, context and leftover samples belong to each call. */
export class SileroStream implements SpeechDetector {
  private state = new Float32Array(256);
  private context = new Float32Array(32);
  private samples: number[] = [];
  private speech = false;
  constructor(private infer: VadKernel, private threshold = 0.5) {}
  async push(frame: Buffer): Promise<boolean> {
    if (frame.length !== 160) throw new Error("Expected 20 ms of mu-law audio");
    for (const byte of frame) this.samples.push(muLawSample(byte));
    if (this.samples.length >= 256) {
      const input = new Float32Array(288);
      input.set(this.context); input.set(this.samples.splice(0, 256), 32);
      const result = await this.infer(input, this.state);
      if (!Number.isFinite(result.probability) || result.probability < 0 || result.probability > 1 || result.state.length !== 256) throw new Error("Invalid Silero VAD result");
      this.state = new Float32Array(result.state); this.context = input.slice(-32);
      this.speech = result.probability >= (this.speech ? Math.max(0.01, this.threshold - 0.15) : this.threshold);
    }
    return this.speech;
  }
  reset() { this.state.fill(0); this.context.fill(0); this.samples = []; this.speech = false; }
}

export async function loadSilero(path: string, threshold = 0.5) {
  // Loading the native binding and model happens only during explicitly requested server startup.
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(path, {
    executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1,
    executionMode: "sequential", graphOptimizationLevel: "all",
  });
  const infer: VadKernel = async (input, state) => {
    const feeds = { input: new ort.Tensor("float32", input, [1, 288]),
      state: new ort.Tensor("float32", state, [2, 1, 128]), sr: new ort.Tensor("int64", BigInt64Array.of(8000n), []) };
    let outputs: Awaited<ReturnType<typeof session.run>> | undefined;
    try {
      outputs = await session.run(feeds);
      if (!outputs.output || !outputs.stateN) throw new Error("Unexpected Silero ONNX outputs");
      return { probability: Number(outputs.output.data[0]), state: new Float32Array(outputs.stateN.data as Float32Array) };
    } finally {
      Object.values(feeds).forEach(tensor => tensor.dispose());
      if (outputs) Object.values(outputs).forEach(tensor => tensor.dispose());
    }
  };
  try { await infer(new Float32Array(288), new Float32Array(256)); }
  catch (error) { await session.release(); throw error; }
  return { create: () => new SileroStream(infer, threshold), close: () => session.release() };
}
