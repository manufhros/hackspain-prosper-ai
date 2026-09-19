/** Limits in-flight work; cancellation removes queued work without releasing active capacity. */
export class WorkQueue {
  private active = 0;
  private waiting: { start(): void; cancel(): void }[] = [];
  constructor(readonly capacity: number, private limit = 60) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid queue capacity");
  }
  run<T>(work: (queueMs: number) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.waiting.length >= this.limit) return Promise.reject(new Error("Inference queue is full"));
    const queuedAt = performance.now();
    return new Promise<T>((resolve, reject) => {
      const job = {
        start: () => {
          signal.removeEventListener("abort", job.cancel);
          if (signal.aborted) { reject(signal.reason); this.drain(); return; }
          this.active++;
          Promise.resolve().then(() => work(Math.round(performance.now() - queuedAt)))
            .then(resolve, reject).finally(() => { this.active--; this.drain(); });
        },
        cancel: () => {
          const index = this.waiting.indexOf(job);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(signal.reason ?? new Error("Cancelled"));
        },
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      this.waiting.push(job); this.drain();
    });
  }
  private drain() {
    while (this.active < this.capacity && this.waiting.length) this.waiting.shift()!.start();
  }
}
