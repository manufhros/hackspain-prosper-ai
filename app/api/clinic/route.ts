import { NextResponse } from "next/server";
import { getClinicSource } from "@/lib/clinic/source";

export async function GET() {
  const source = getClinicSource();
  const health = await source.health();
  return NextResponse.json({ source: source.info, health });
}
