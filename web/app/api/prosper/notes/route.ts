import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Notas locales por run (análisis de logs, etc.). No viene de Prosper.
export async function GET() {
  try {
    const raw = await readFile(join(process.cwd(), "data", "run-notes.json"), "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({});
  }
}
