import { NextResponse } from "next/server";
import { HttpClinicSource } from "@/lib/clinic/http";

export async function POST(request: Request) {
  const body = (await request.json()) as { baseUrl?: string; apiKey?: string };
  if (!body.baseUrl || !body.apiKey) {
    return NextResponse.json({ ok: false, error: "baseUrl and apiKey required" }, { status: 400 });
  }
  const source = new HttpClinicSource({
    name: "Probe",
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
  });
  try {
    const health = await source.health();
    if (!health.ok) return NextResponse.json({ ok: false, health });
    const catalog = await source.clinic();
    return NextResponse.json({
      ok: true,
      health,
      clinic_name: catalog.clinic_name,
      patient_count: catalog.patient_count,
      providers: catalog.providers.length,
      locations: catalog.locations.length,
      specialties: catalog.specialties.length,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "probe failed",
    });
  }
}
