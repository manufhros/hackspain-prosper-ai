import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

// One ephemeral shared secret for the two local processes, never printed or saved.
const port = process.env.PORT || "7860";
const deskPort = process.env.DESK_PORT || "3100";
const env = { ...process.env, OPERATIONS_SECRET: process.env.OPERATIONS_SECRET || randomBytes(32).toString("hex"),
  OPERATIONS_API_URL: `http://127.0.0.1:${port}`, PORT: port };
const voice = spawn(process.execPath, ["--import", "tsx", "src/agent/server.ts"], { stdio: "inherit", env });
const desk = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", deskPort], { cwd: resolve("desk"), stdio: "inherit", env });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true; voice.kill("SIGTERM"); desk.kill("SIGTERM");
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);
voice.on("exit", stop); desk.on("exit", stop);
console.log(`Operaciones: http://localhost:${deskPort}/panel/operaciones`);
