"use client";

import { useDeskSettings } from "./useDeskSettings";

/**
 * Shows what the patient said, honouring the workspace's zero-retention
 * preference. Demo accounts never carry transcripts.
 */
export function Motive({ org, text, live }: { org: string; text: string; live: boolean }) {
  const [settings] = useDeskSettings(org);
  if (!live) return <span className="muted">Sin transcripción (cuenta demo)</span>;
  if (settings.zeroRetention) return <span className="muted">Oculto · retención cero</span>;
  return <span title={text}>{text || "—"}</span>;
}
