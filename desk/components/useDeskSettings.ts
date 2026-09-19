"use client";

import { useCallback, useSyncExternalStore } from "react";

export type DeskSettings = {
  zeroRetention: boolean;
  keepDays: number;
  recordCalls: boolean;
  euOnly: boolean;
};

export const DEFAULT_SETTINGS: DeskSettings = {
  zeroRetention: false,
  keepDays: 30,
  recordCalls: false,
  euOnly: true,
};

const EVENT = "hash:desk-settings";

function storageKey(org: string) {
  return `pupitre:${org}:settings`;
}

function parse(raw: string | null): DeskSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DeskSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Non-hook read, safe on the server (returns defaults there). */
export function loadSettings(org: string): DeskSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return parse(localStorage.getItem(storageKey(org)));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

/**
 * Per-workspace panel preferences kept in this browser only. Hydration-safe:
 * the server snapshot is the default set, the client snapshot is localStorage.
 */
export function useDeskSettings(org: string) {
  const key = storageKey(org);
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const settings = parse(raw || null);
  const save = useCallback(
    (next: DeskSettings) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep in-memory defaults */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [settings, save] as const;
}
