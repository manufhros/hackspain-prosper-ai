import { platform } from "../platform/index.ts";

const health = await platform.health();
const directory = await platform.directory({
  name: "Josefa Domínguez Navarro",
  national_id: "48064716Y",
});
const match = directory.matches[0];
if (health.status !== "healthy") {
  throw new Error(`clinic unhealthy: ${JSON.stringify(health)}`);
}
if (match?.patient_id !== "P00001" || match.insurer !== "mapfre") {
  throw new Error(`directory miss: ${JSON.stringify(directory.matches)}`);
}

const availability = await platform.availability({
  date_from: "2026-09-19",
  date_to: "2026-09-26",
  patient_id: "P00001",
  specialty_id: "general_practice",
  insurer: ["mapfre"],
});
const slot = availability.slots.find((item) => item.start_time.startsWith("2026-09-19T11:00:00"));
if (!slot || availability.appointment_type.id !== "review") {
  throw new Error(`no review slot at 19 Sep 11:00: ${JSON.stringify({
    type: availability.appointment_type,
    firstSlots: availability.slots.slice(0, 3),
  })}`);
}

let local: string = "down";
try {
  const response = await fetch("http://127.0.0.1:7860/health");
  local = response.ok ? "up" : `http ${response.status}`;
} catch {
  local = "down";
}

console.log({
  clinic: health.status,
  patient: match.patient_id,
  type: availability.appointment_type.id,
  slot: slot.start_time,
  agent: local,
});
if (local !== "up") {
  console.log("start npm run dev if you want to confirm /health on :7860");
}
