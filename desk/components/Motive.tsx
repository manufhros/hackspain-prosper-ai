"use client";

import { useEffect, useState } from "react";
import { loadSettings } from "./SettingsForm";

export function Motive({ org, text, live }: { org: string; text: string; live: boolean }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(loadSettings(org).zeroRetention);
  }, [org]);
  if (!live) return <span className="muted">Sin transcripción (cuenta demo)</span>;
  if (hidden) return <span className="muted">Oculto · retención cero</span>;
  return <span>{text || "—"}</span>;
}
