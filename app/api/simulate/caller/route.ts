import { getPublicCase } from "@/lib/cases/load";
import { nextCallerLine, speakCaller } from "@/lib/voice/speech";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    caseId?: string;
    history?: Array<{ role: "agent" | "patient"; text: string }>;
  };
  const item = body.caseId ? getPublicCase(body.caseId) : undefined;
  if (!item) return Response.json({ error: "unknown case" }, { status: 404 });

  const text = await nextCallerLine({
    callerPrompt: item.caller_prompt,
    language: item.language,
    history: body.history ?? [],
  });
  if (!text || /\[HANGUP\]/i.test(text)) {
    return Response.json({ hangup: true, text: "" });
  }

  const voice = item.persona.voice === "male" ? "onyx" : "alloy";
  const spoken = await speakCaller(text, voice);
  return Response.json({
    hangup: false,
    text,
    muLaw: b64(spoken.muLaw),
    wav: b64(spoken.wav),
  });
}
