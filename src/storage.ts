import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./data";
import { baseUrl } from "./api";
import { isObject } from "./validation";

export const stateDir = join(root, ".workbench");
export interface Config { origin: string; endpoint: string }
export async function loadConfig(): Promise<Config> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(stateDir, "config.json"), "utf8"));
    if (!isObject(parsed) || typeof parsed.origin !== "string" || typeof parsed.endpoint !== "string") throw new Error("Invalid workbench configuration");
    return { origin: parsed.origin ? baseUrl(parsed.origin) : "", endpoint: parsed.endpoint };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { origin: "", endpoint: "" };
    throw error;
  }
}
export async function saveLocal(name: string, value: unknown, directory = stateDir): Promise<string> {
  if (!/^[a-zA-Z0-9_.-]+\.json$/.test(name)) throw new Error("Invalid local artifact name");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, name);
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, path);
  return path;
}
export async function saveConfig(config: Config): Promise<void> {
  await saveLocal("config.json", { origin: config.origin ? baseUrl(config.origin) : "", endpoint: config.endpoint });
}
export async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (file.size > 16 * 1024 * 1024) throw new Error("Import exceeds the 16 MiB workbench limit");
  return file.json();
}
