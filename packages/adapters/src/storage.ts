import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type {
  Delivery,
  DomainEvent,
  Repository,
} from "../../contracts/src/index.js";
export class MemoryRepository implements Repository {
  protected log: DomainEvent[] = [];
  protected outbox = new Map<string, Delivery>();
  async append(event: DomainEvent) {
    this.log.push(structuredClone(event));
  }
  async events(callId?: string) {
    return structuredClone(
      this.log.filter((e) => !callId || e.callId === callId),
    );
  }
  async putDelivery(delivery: Delivery) {
    this.outbox.set(delivery.id, structuredClone(delivery));
  }
  async deliveries() {
    return structuredClone([...this.outbox.values()]);
  }
  async close() {}
}
/** Single-process local persistence. Use PostgreSQL before running replicas. */
export class FileRepository extends MemoryRepository {
  private chain: Promise<void> = Promise.resolve();
  private constructor(private dir: string) {
    super();
  }
  static async open(dir: string) {
    const store = new FileRepository(dir);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(
        await readFile(join(dir, "state.json"), "utf8"),
      ) as { events: DomainEvent[]; deliveries: Delivery[] };
      store.log = data.events;
      store.outbox = new Map(data.deliveries.map((d) => [d.id, d]));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return store;
  }
  private flush() {
    const data = JSON.stringify({
      events: this.log,
      deliveries: [...this.outbox.values()],
    });
    const work = this.chain.then(async () => {
      const path = join(this.dir, "state.json");
      await writeFile(path + ".tmp", data, { mode: 0o600 });
      await rename(path + ".tmp", path);
    });
    this.chain = work.catch(() => {});
    return work;
  }
  override async append(event: DomainEvent) {
    await super.append(event);
    await this.flush();
  }
  override async putDelivery(delivery: Delivery) {
    await super.putDelivery(delivery);
    await this.flush();
  }
  override async close() {
    await this.chain;
  }
}
export class PostgresRepository implements Repository {
  private constructor(private pool: pg.Pool) {}
  static async open(connectionString: string) {
    const pool = new pg.Pool({ connectionString, max: 5 });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS call_events (id text PRIMARY KEY, call_id text NOT NULL, sequence integer NOT NULL, data jsonb NOT NULL, UNIQUE(call_id,sequence)); CREATE TABLE IF NOT EXISTS deliveries (id text PRIMARY KEY, data jsonb NOT NULL)`,
    );
    return new PostgresRepository(pool);
  }
  async append(event: DomainEvent) {
    await this.pool.query(
      "INSERT INTO call_events(id,call_id,sequence,data) VALUES($1,$2,$3,$4)",
      [event.id, event.callId, event.sequence, event],
    );
  }
  async events(callId?: string) {
    const r = await this.pool.query<{ data: DomainEvent }>(
      "SELECT data FROM call_events WHERE ($1::text IS NULL OR call_id=$1) ORDER BY call_id,sequence",
      [callId ?? null],
    );
    return r.rows.map((r) => r.data);
  }
  async putDelivery(delivery: Delivery) {
    await this.pool.query(
      "INSERT INTO deliveries(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
      [delivery.id, delivery],
    );
  }
  async deliveries() {
    const r = await this.pool.query<{ data: Delivery }>(
      "SELECT data FROM deliveries",
    );
    return r.rows.map((r) => r.data);
  }
  async close() {
    await this.pool.end();
  }
}
