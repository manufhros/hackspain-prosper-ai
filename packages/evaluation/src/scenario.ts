import { randomUUID } from "node:crypto";
import { MemoryRepository } from "../../adapters/src/storage.js";
import { FixtureClinic, MemorySink } from "../../adapters/src/clinic.js";
import { TextEngine } from "../../conversation/src/engines.js";
import { DeliveryService } from "../../runtime/src/delivery.js";
import { CallRuntime } from "../../runtime/src/session.js";
export async function bookingScenario() {
  const repository = new MemoryRepository(),
    sink = new MemorySink();
  const runtime = new CallRuntime(
    new TextEngine(),
    new FixtureClinic(),
    repository,
    new DeliveryService(repository, sink),
    randomUUID(),
    new Date("2026-09-18T10:00:00Z"),
    () => {},
  );
  await runtime.start();
  for (const command of [
    "/tool create_task {}",
    '/tool verify_patient {"task_id":"$task","national_id":"12345678Z","date_of_birth":"1988-03-14"}',
    '/tool set_request {"task_id":"$task","request":{"date_from":"2026-09-21","date_to":"2026-09-21","specialty_id":"general_practice"}}',
    '/tool find_slots {"task_id":"$task"}',
    '/tool propose_booking {"task_id":"$task","slot_index":0,"policy_id":"sanitas"}',
    "sí",
  ])
    await runtime.text(command);
  await runtime.close();
  return { runtime, repository, sink };
}
