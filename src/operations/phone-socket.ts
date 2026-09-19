import { EventEmitter } from "node:events";
import type { CallSocket } from "../agent/socket.ts";

/** REST streams are inbound-only. Never send agent media/marks back to that socket. */
export class PatientPhoneSocket extends EventEmitter implements CallSocket {
  constructor(private readonly wire: CallSocket, callId: string, from: string) {
    super();
    wire.on("message", raw => {
      try {
        const message = JSON.parse(String(raw));
        if (message.event === "start") message.start.customParameters = {
          call_id: callId, org_slug: "arenal", from_number: from,
        };
        this.emit("message", JSON.stringify(message));
      } catch { this.emit("error", new Error("Invalid phone stream frame")); }
    });
    wire.on("close", (code, reason) => this.emit("close", code, reason));
    wire.on("error", error => this.emit("error", error));
  }
  get readyState() { return this.wire.readyState; }
  send(_data: string) { /* Playback uses TwiML, not a bidirectional socket. */ }
  close(code?: number, reason?: string) { this.wire.close(code, reason); }
}
