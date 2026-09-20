import { CallRefresh } from "@/components/CallRefresh";
import { VoiceSimulator } from "@/components/VoiceSimulator";
import { canOpen, homeFor } from "@/lib/auth";
import { deskLines } from "@/lib/call-data";
import { CLINIC } from "@/lib/clinic";
import { getSession } from "@/lib/session";
import { voiceAgentWsUrl } from "@/lib/voice-endpoint";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TiempoReal() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!canOpen(session.role, "/pruebas")) redirect(homeFor(session));
  const board = await deskLines(CLINIC.slug);

  return (
    <>
      <CallRefresh />
      <VoiceSimulator
        endpoint={await voiceAgentWsUrl()}
        orgSlug={CLINIC.slug}
        handoffNumber={process.env.VOICE_TEST_PHONE?.trim() || ""}
        board={board}
      />
    </>
  );
}
