import { platform } from "../platform/index.ts";

const health = await platform.health();
const catalog = await platform.clinic();
const directory = await platform.directory({
  name: "Josefa Domínguez Navarro",
  national_id: "48064716Y",
});

console.log({
  health,
  clinic: catalog.clinic_name,
  patients: catalog.patient_count,
  sites: catalog.locations.map((site) => site.id),
  matches: directory.matches.map((match) => ({
    id: match.patient_id,
    insurer: match.insurer,
    seen: match.has_visited_before,
  })),
});
