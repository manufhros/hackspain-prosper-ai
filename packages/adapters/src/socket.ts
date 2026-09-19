import WebSocket from "ws";
export type SocketFactory = (
  url: string,
  headers: Record<string, string>,
) => WebSocket;
export const socketFactory: SocketFactory = (url, headers) =>
  new WebSocket(url, {
    headers,
    handshakeTimeout: 10000,
    maxPayload: 4 * 1024 * 1024,
  });
export function opened(socket: WebSocket, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve();
    };
    const onOpen = () => done();
    const onError = () => done(new Error("Provider connection failed"));
    const onClose = () => done(new Error("Provider connection closed"));
    const onAbort = () => {
      socket.close();
      done(new Error("Aborted"));
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private failure?: Error;
  push(value: T) {
    if (this.done) return;
    const waiter = this.waiting.shift();
    if (waiter) waiter({ value, done: false });
    else {
      if (this.items.length >= 2048) {
        this.end(new Error("Stream buffer exceeded"));
        return;
      }
      this.items.push(value);
    }
  }
  end(error?: Error) {
    this.done = true;
    this.failure = error;
    for (const w of this.waiting.splice(0)) w({ value: undefined, done: true });
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.failure) throw this.failure;
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.done) return;
      const value = await new Promise<IteratorResult<T>>((r) =>
        this.waiting.push(r),
      );
      if (this.failure) throw this.failure;
      if (value.done) return;
      yield value.value;
    }
  }
}
