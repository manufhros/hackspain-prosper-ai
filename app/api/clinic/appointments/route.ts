import { NextResponse } from "next/server";
import { getClinicSource } from "@/lib/clinic/source";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const patientId = url.searchParams.get("patient_id");
  if (!patientId) {
    return NextResponse.json({ error: "patient_id required" }, { status: 400 });
  }
  const when = url.searchParams.get("when");
  try {
    const result = await getClinicSource().appointments(
      patientId,
      when === "past" || when === "all" || when === "upcoming" ? when : "upcoming",
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "appointments failed" },
      { status: 502 },
    );
  }
}
