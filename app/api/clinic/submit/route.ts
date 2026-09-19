import { NextResponse } from "next/server";
import { ClinicApiError } from "@/lib/clinic/errors";
import { dispatchSubmit } from "@/lib/clinic/dispatch";
import { getClinicSource } from "@/lib/clinic/source";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = getClinicSource();
  const callId = typeof body.call_id === "string" ? body.call_id.trim() : "";
  if (source.info.kind === "rest" && !callId) {
    return NextResponse.json(
      {
        error:
          "This clinic requires a call_id to submit (Prosper only accepts reports on an open call). Use the fixture source, or pass a live call_id.",
      },
      { status: 400 },
    );
  }
  try {
    const result = await dispatchSubmit(source, body);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ClinicApiError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "submit failed" },
      { status: status >= 400 ? status : 502 },
    );
  }
}
