import { NextResponse } from "next/server";
import { getClinicSource } from "@/lib/clinic/source";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date_from = url.searchParams.get("date_from");
  const date_to = url.searchParams.get("date_to");
  if (!date_from || !date_to) {
    return NextResponse.json({ error: "date_from and date_to required" }, { status: 400 });
  }
  const insurer = url.searchParams.getAll("insurer");
  try {
    const result = await getClinicSource().availability({
      date_from,
      date_to,
      provider_id: url.searchParams.get("provider_id") ?? undefined,
      specialty_id: url.searchParams.get("specialty_id") ?? undefined,
      location_id: url.searchParams.get("location_id") ?? undefined,
      patient_id: url.searchParams.get("patient_id") ?? undefined,
      insurer: insurer.length ? insurer : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "availability failed" },
      { status: 502 },
    );
  }
}
