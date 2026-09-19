import { NextResponse } from "next/server";
import { getClinicSource } from "@/lib/clinic/source";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await getClinicSource().directory({
      name: url.searchParams.get("name") ?? undefined,
      national_id: url.searchParams.get("national_id") ?? undefined,
      phone: url.searchParams.get("phone") ?? undefined,
      date_of_birth: url.searchParams.get("date_of_birth") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "directory failed" },
      { status: 502 },
    );
  }
}
