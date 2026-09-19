import { WebSocket } from "ws";
import type { CallSocket } from "./socket.ts";

export function connectNodeSocket(url: string): Promise<CallSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("elevenlabs ws timeout"));
    }, 12_000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
