"use client";

import { useEffect, useState } from "react";

export type DeskSettings = {
  zeroRetention: boolean;
  keepDays: number;
  recordCalls: boolean;
  euOnly: boolean;
};

const DEFAULTS: DeskSettings = {
  zeroRetention: false,
  keepDays: 30,
  recordCalls: false,
  euOnly: true,
};

export function loadSettings(org: string): DeskSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(`pupitre:${org}:settings`);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function Row({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <label className="set-row">
      <span>
        <strong>{title}</strong>
        <em>{copy}</em>
      </span>
      {children}
    </label>
  );
}

export function SettingsForm({ org }: { org: string }) {
  const [s, setS] = useState<DeskSettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setS(loadSettings(org));
  }, [org]);

  function write(next: DeskSettings) {
    setS(next);
    localStorage.setItem(`pupitre:${org}:settings`, JSON.stringify(next));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <form
      className="set-list"
      onSubmit={(e) => {
        e.preventDefault();
        write(s);
      }}
    >
      <Row
        title="Retención cero"
        copy="No se guarda transcripción ni audio. El panel deja de mostrar el motivo de la llamada."
      >
        <input
          type="checkbox"
          checked={s.zeroRetention}
          onChange={(e) => write({ ...s, zeroRetention: e.target.checked, keepDays: e.target.checked ? 0 : 30 })}
        />
      </Row>
      <Row title="Días en archivo" copy="0 si retención cero. Solo metadatos de cita (quién, cuándo, sede).">
        <select
          value={s.keepDays}
          disabled={s.zeroRetention}
          onChange={(e) => write({ ...s, keepDays: Number(e.target.value) })}
        >
          <option value={0}>0</option>
          <option value={1}>1</option>
          <option value={7}>7</option>
          <option value={30}>30</option>
        </select>
      </Row>
      <Row title="Grabar audio" copy="Apagado por defecto. Independiente del modelo de voz.">
        <input
          type="checkbox"
          checked={s.recordCalls}
          onChange={(e) => write({ ...s, recordCalls: e.target.checked })}
        />
      </Row>
      <Row title="Solo Unión Europea" copy="Los logs no salen de región EU.">
        <input
          type="checkbox"
          checked={s.euOnly}
          onChange={(e) => write({ ...s, euOnly: e.target.checked })}
        />
      </Row>
      {saved ? <p className="saved">Guardado en este navegador. No cambia el agente en producción.</p> : null}
    </form>
  );
}
