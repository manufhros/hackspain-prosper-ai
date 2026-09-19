import assert from "node:assert/strict";
import { bookingScenario } from "./scenario.js";
const runs = await Promise.all(
  Array.from({ length: 20 }, () => bookingScenario()),
);
for (const { runtime, sink } of runs) {
  const actions = sink.records.get(runtime.callId);
  assert.equal(actions?.length, 1);
  assert.equal(actions?.[0]?.action, "BOOK");
}
console.log(
  "PASS: 20 sesiones independientes, 20 reservas confirmadas y entregadas.",
);
console.log(
  "Evaluación sintética del sistema; no mide reconocimiento de voz ni puntuación de Prosper.",
);
