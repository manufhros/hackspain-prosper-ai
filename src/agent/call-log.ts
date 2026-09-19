import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), "logs");

function madridParts(date: Date): { wall: string; zone: "CET" | "CEST" } {
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    fractionalSecondDigits: 3,
  }).format(date);
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
  const zone = /[+]?2/.test(offset) ? "CEST" : "CET";
  return { wall, zone };
}

function madridStamp(date = new Date()): string {
  const { wall, zone } = madridParts(date);
  return `${wall.replace(" ", "T")} ${zone}`;
}

const started = madridParts(new Date());
const RUN_STAMP = `${started.wall.replace(/[:.]/g, "-").replace(" ", "_").slice(0, 19)}_${started.zone}`;
export const LOG_FILE = join(LOG_DIR, `calls-${RUN_STAMP}.log`);

function line(parts: unknown[]): string {
  const stamp = madridStamp();
  const text = parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part instanceof Error) return part.stack ?? part.message;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ");
  return `[${stamp}] ${text}\n`;
}

/** Writes every call event to stdout and to a new logs/calls-<start>.log per process. */
export function callLog(...parts: unknown[]): void {
  console.log(...parts);
  if (process.env.VOICE_STORAGE === "d1") return;
  void mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, line(parts)))
    .catch((error: unknown) => {
      console.error("call-log write failed", error);
    });
}

export function callLogError(...parts: unknown[]): void {
  console.error(...parts);
  if (process.env.VOICE_STORAGE === "d1") return;
  void mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, line(["ERROR", ...parts])))
    .catch((error: unknown) => {
      console.error("call-log write failed", error);
    });
}

export function callLogWarn(...parts: unknown[]): void {
  console.warn(...parts);
  if (process.env.VOICE_STORAGE === "d1") return;
  void mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, line(["WARN", ...parts])))
    .catch((error: unknown) => {
      console.error("call-log write failed", error);
    });
}
