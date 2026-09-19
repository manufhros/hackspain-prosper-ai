import { NextResponse } from "next/server";
import { getClinicSource } from "@/lib/clinic/source";

export async function GET() {
  try {
    const catalog = await getClinicSource().clinic();
    return NextResponse.json(catalog);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "clinic failed" },
      { status: 502 },
    );
  }
}
