/** The small WebSocket surface used by the call engine, shared by Node and Workers. */
export interface CallSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: string | { toString(): string }) => void): this;
  on(event: "close", listener: (code: number, reason: { toString(): string }) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: () => void): this;
}

export const SOCKET_OPEN = 1;
