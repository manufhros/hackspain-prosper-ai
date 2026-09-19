"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { type DeskSettings, useDeskSettings } from "./useDeskSettings";
import styles from "./SettingsForm.module.css";

export { loadSettings, type DeskSettings } from "./useDeskSettings";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.toggle}
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}

function Row({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsForm({ org }: { org: string }) {
  const [settings, save] = useDeskSettings(org);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (savedAt == null) return;
    const timer = window.setTimeout(() => setSavedAt(null), 1600);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  function write(next: DeskSettings) {
    save(next);
    setSavedAt(Date.now());
  }

  return (
    <div className={styles.form}>
      <section className={styles.section}>
        <header>
          <h2>Datos de la llamada</h2>
          <p>Transcripción, audio y motivo</p>
        </header>
        <Row title="Retención cero" copy="No se guarda transcripción ni audio. El panel deja de mostrar el motivo de cada llamada.">
          <Toggle
            label="Retención cero"
            checked={settings.zeroRetention}
            onChange={(value) => write({ ...settings, zeroRetention: value, keepDays: value ? 0 : 30 })}
          />
        </Row>
        <Row title="Días en archivo" copy="Solo metadatos de cita: quién, cuándo y en qué sede. 0 si retención cero.">
          <select
            className={styles.select}
            value={settings.keepDays}
            disabled={settings.zeroRetention}
            aria-label="Días en archivo"
            onChange={(event) => write({ ...settings, keepDays: Number(event.target.value) })}
          >
            <option value={0}>0 días</option>
            <option value={1}>1 día</option>
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
          </select>
        </Row>
        <Row title="Grabar audio" copy="Apagado por defecto. Independiente del modelo de voz.">
          <Toggle label="Grabar audio" checked={settings.recordCalls} onChange={(value) => write({ ...settings, recordCalls: value })} />
        </Row>
      </section>

      <section className={styles.section}>
        <header>
          <h2>Residencia de los datos</h2>
          <p>Dónde se procesan y almacenan los registros</p>
        </header>
        <Row title="Solo Unión Europea" copy="Los logs no salen de la región EU. Recomendado para cumplir el RGPD.">
          <Toggle label="Solo Unión Europea" checked={settings.euOnly} onChange={(value) => write({ ...settings, euOnly: value })} />
        </Row>
      </section>

      <p className={styles.saved} data-visible={savedAt != null} role="status" aria-live="polite">
        <Check size={14} aria-hidden="true" />
        Guardado en este navegador
      </p>
    </div>
  );
}
