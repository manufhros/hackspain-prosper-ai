import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoggedCall } from "./types";

export async function readLiveCalls(): Promise<LoggedCall[]> {
  try {
    const parsed = JSON.parse(
      await readFile(path.resolve(process.cwd(), "lib", "from-logs.json"), "utf8"),
    ) as { calls?: LoggedCall[] };
    return (parsed.calls ?? []).sort((a, b) =>
      String(b.started ?? "").localeCompare(String(a.started ?? "")),
    );
  } catch {
    return [];
  }
}
