import { spawn } from "node:child_process";
import { env } from "../config.ts";

export type Credentials = { apiKey: string; agentId: string };
export type CredentialStore = {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
};
const SERVICE = "dev.lucia.console.elevenlabs";

// Feed secrets via stdin, never process arguments, shell interpolation, or logs.
export const keychain: CredentialStore = {
  read: () =>
    new Promise((resolve) => {
      if (process.platform !== "darwin") {
        resolve(undefined);
        return;
      }
      const child = spawn(
        "/usr/bin/security",
        ["find-generic-password", "-s", SERVICE, "-a", "provider", "-w"],
        { stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 },
      );
      let result = "";
      child.stdout.on("data", (chunk: Buffer) => {
        result += chunk.toString();
      });
      child.on("error", () => resolve(undefined));
      child.on("close", (code) =>
        resolve(code === 0 ? result.trim() : undefined),
      );
    }),
  write: (value) =>
    new Promise((resolve, reject) => {
      if (process.platform !== "darwin") {
        reject(new Error("Guardar credenciales requiere el Llavero de macOS."));
        return;
      }
      const child = spawn("/usr/bin/security", ["-i"], {
        stdio: ["pipe", "ignore", "pipe"],
        timeout: 30_000,
      });
      const quoted = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      let failed = false;
      child.stderr.on("data", (chunk: Buffer) => {
        if (/SecKeychain|error|failed|denied/i.test(chunk.toString()))
          failed = true;
      });
      child.on("error", () =>
        reject(new Error("No se pudo abrir el Llavero de macOS.")),
      );
      child.on("close", (code) =>
        code === 0 && !failed
          ? resolve()
          : reject(
              new Error("No se pudo guardar la clave en el Llavero de macOS."),
            ),
      );
      child.stdin.on("error", () => {
        failed = true;
      });
      child.stdin.end(
        `add-generic-password -U -s ${SERVICE} -a provider -w "${quoted}"\n`,
      );
    }),
};

export class ProviderSettings {
  private credentials: Credentials;
  private source = "environment";
  private saving = false;
  constructor(
    private readonly vault: CredentialStore = keychain,
    initial: Credentials = {
      apiKey: env.elevenLabsApiKey,
      agentId: env.elevenLabsAgentId,
    },
  ) {
    this.credentials = initial;
  }

  async load(): Promise<void> {
    const saved = await this.vault.read();
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Credentials;
      this.credentials = this.validate(parsed);
      this.source = "keychain";
    } catch {
      /* Keep environment fallback for a missing or invalid entry. */
    }
  }

  get(): Credentials {
    return { ...this.credentials };
  }
  public() {
    return {
      agentId: this.credentials.agentId,
      hasApiKey: Boolean(this.credentials.apiKey),
      source: this.source,
    };
  }

  private validate(value: unknown): Credentials {
    const body =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : this.credentials.apiKey;
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(agentId))
      throw new Error("Introduce un identificador de agente válido.");
    if (!apiKey || apiKey.length > 4096 || /[^\x21-\x7E]/.test(apiKey))
      throw new Error("Introduce una clave API válida.");
    return { apiKey, agentId };
  }

  async save(value: unknown): Promise<ReturnType<ProviderSettings["public"]>> {
    if (this.saving) throw new Error("Ya hay un cambio de proveedor en curso.");
    const next = this.validate(value);
    this.saving = true;
    try {
      await this.vault.write(JSON.stringify(next));
      this.credentials = next;
      this.source = "keychain";
      return this.public();
    } finally {
      this.saving = false;
    }
  }

  async test(
    value: unknown,
    request: typeof fetch = fetch,
  ): Promise<{ name: string }> {
    const draft = this.validate(value);
    const response = await request(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(draft.agentId)}`,
      {
        headers: { "xi-api-key": draft.apiKey },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "ElevenLabs no acepta la clave o sus permisos. Revisa el acceso al agente."
          : response.status === 404
            ? "No se ha encontrado este agente en ElevenLabs."
            : "ElevenLabs no está disponible. Inténtalo de nuevo.",
      );
    const result = (await response.json()) as { name?: string };
    return {
      name: typeof result.name === "string" ? result.name : draft.agentId,
    };
  }
}
