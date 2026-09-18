import { mkdir, writeFile } from "node:fs/promises";
import { platform } from "../platform/index.ts";

const out = new URL("../../data/clinic.json", import.meta.url);

const catalog = await platform.clinic();
await mkdir(new URL("./", out), { recursive: true });
await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`);

console.log(
  `${catalog.clinic_name}: ${catalog.patient_count} patients, ${catalog.providers.length} providers → data/clinic.json`,
);
