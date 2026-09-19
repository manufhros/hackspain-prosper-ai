import { transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { PHONE_RATE, pcm16ToWav, rms, wavToPcm16 } from "@/lib/audio/phone";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return Response.json({ text: "", error: "file required" });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = wavToPcm16(bytes);
    if (decoded.pcm.length < PHONE_RATE * 0.35 || rms(decoded.pcm) < 350) {
      return Response.json({ text: "" });
    }
    const result = await transcribe({
      model: gateway.transcriptionModel("openai/whisper-1"),
      audio: pcm16ToWav(decoded.pcm, decoded.sampleRate),
    });
    return Response.json({ text: result.text.trim() });
  } catch (error) {
    return Response.json({
      text: "",
      error: error instanceof Error ? error.message : "transcribe failed",
    });
  }
}
