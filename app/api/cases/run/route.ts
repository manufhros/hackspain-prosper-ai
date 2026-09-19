import { NextResponse } from "next/server";
import { runPublicCases } from "@/lib/cases/replay";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    baseUrl?: string;
    apiKey?: string;
  };
  const connection =
    body.baseUrl && body.apiKey
      ? { baseUrl: body.baseUrl, apiKey: body.apiKey }
      : undefined;
  const ran = await runPublicCases({ ids: body.ids, connection });
  const passed = ran.results.filter((item) => item.passed).length;
  return NextResponse.json({
    source: ran.source,
    passed,
    failed: ran.results.length - passed,
    results: ran.results,
  });
}
