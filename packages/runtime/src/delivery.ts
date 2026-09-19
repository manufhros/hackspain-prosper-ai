import { createHash } from "node:crypto";
import type {
  Action,
  ActionSink,
  Delivery,
  Repository,
} from "../../contracts/src/index.js";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export class DeliveryService {
  private flights = new Map<string, Promise<Delivery>>();
  constructor(
    private repository: Repository,
    private sink: ActionSink,
    private now = () => Date.now(),
  ) {}
  async prepare(
    callId: string,
    taskId: string,
    action: Action,
    closedAt: number,
  ) {
    const id = createHash("sha256")
      .update(canonical({ callId, action }))
      .digest("hex");
    const existing = (await this.repository.deliveries()).find(
      (d) => d.id === id,
    );
    if (existing) return existing;
    const delivery: Delivery = {
      id,
      callId,
      taskId,
      action,
      status: "pending",
      attempts: 0,
      deadline: new Date(closedAt + 30000).toISOString(),
    };
    await this.repository.putDelivery(delivery);
    return delivery;
  }
  send(delivery: Delivery): Promise<Delivery> {
    const flight = this.flights.get(delivery.id);
    if (flight) return flight;
    const work = this.attempt(delivery).finally(() =>
      this.flights.delete(delivery.id),
    );
    this.flights.set(delivery.id, work);
    return work;
  }
  private async attempt(delivery: Delivery) {
    const current =
      (await this.repository.deliveries()).find((d) => d.id === delivery.id) ??
      delivery;
    if (current.status !== "pending") return current;
    const remaining = Date.parse(current.deadline) - this.now();
    if (remaining <= 0) {
      current.status = "expired";
      await this.repository.putDelivery(current);
      return current;
    }
    current.attempts++;
    await this.repository.putDelivery(current);
    try {
      const receipt = await this.sink.deliver(
        current.callId,
        current.action,
        AbortSignal.timeout(Math.max(1, Math.min(5000, remaining))),
      );
      current.receipt = receipt;
      current.status = receipt.status;
    } catch {
      current.status = "pending";
    }
    await this.repository.putDelivery(current);
    return current;
  }
  async recover() {
    const pending = (await this.repository.deliveries()).filter(
      (d) => d.status === "pending",
    );
    return Promise.all(pending.map((d) => this.send(d)));
  }
}
