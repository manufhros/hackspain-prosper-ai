import { PrivacyView } from "@/components/views/PrivacyView";
import { hospitalViewScope } from "@/components/views/build-scope";

export default async function Ajustes({ params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  return <PrivacyView scope={await hospitalViewScope(hid)} />;
}
