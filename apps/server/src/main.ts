import "dotenv/config";
import { config, engineFactory } from "./config.js";
import { createServer } from "./server.js";
import {
  FileRepository,
  MemoryRepository,
  PostgresRepository,
} from "../../../packages/adapters/src/storage.js";
import {
  FixtureClinic,
  MemorySink,
  ProsperHttp,
  ProsperClinic,
  ProsperSink,
} from "../../../packages/adapters/src/clinic.js";
import { initializeTracing, traceEngine, flushTracing } from "../../../packages/adapters/src/tracing.js";
initializeTracing();
const c = config();
const repository =
  c.STORE === "postgres"
    ? await PostgresRepository.open(c.DATABASE_URL)
    : c.STORE === "memory"
      ? new MemoryRepository()
      : await FileRepository.open(c.DATA_DIR);
const http =
  c.CLINIC === "prosper"
    ? new ProsperHttp(c.PLATFORM_API_BASE_URL, c.PLATFORM_API_KEY)
    : undefined;
const app = await createServer(c, {
  repository,
  clinic: http ? new ProsperClinic(http) : new FixtureClinic(),
  sink: http ? new ProsperSink(http) : new MemorySink(),
  engine: () => traceEngine(engineFactory(c)()),
});
await app.listen({ host: c.HOST, port: c.PORT });
console.log(`Arenal: http://${c.HOST}:${c.PORT} — ${c.ENGINE} / ${c.CLINIC}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(flushTracing).finally(() => process.exit(0));
  });
