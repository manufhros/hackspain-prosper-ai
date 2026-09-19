import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Lead = {
  name: string;
  role: string;
  center: string;
  city: string;
  phone: string;
  email: string;
  volume: string;
  at: string;
};

const FILE = path.join(process.cwd(), "data", "leads.json");

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().slice(0, 240);
}

export function leadFromForm(form: FormData): Lead | undefined {
  const name = clean(form.get("name"));
  const center = clean(form.get("center"));
  const email = clean(form.get("email")).toLowerCase();
  if (!name || !center || !email.includes("@")) return undefined;
  return {
    name,
    role: clean(form.get("role")),
    center,
    city: clean(form.get("city")),
    phone: clean(form.get("phone")),
    email,
    volume: clean(form.get("volume")),
    at: new Date().toISOString(),
  };
}

export async function saveLead(lead: Lead) {
  await mkdir(path.dirname(FILE), { recursive: true });
  let list: Lead[] = [];
  try {
    list = JSON.parse(await readFile(FILE, "utf8")) as Lead[];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  list.push(lead);
  await writeFile(FILE, JSON.stringify(list, null, 2));
}
