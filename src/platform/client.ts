import { env } from "../config.ts";
import { PlatformApiError } from "./errors.ts";
import type { AuditAction } from "../agent/audit.ts";
import type {
  Appointment,
  AppointmentWindow,
  AvailabilityQuery,
  AvailabilityResponse,
  BookRequest,
  CancelRequest,
  ClinicCatalog,
  DirectoryQuery,
  DirectoryResponse,
  ReasonRequest,
  RegisterRequest,
  RescheduleRequest,
  SubmitResponse,
} from "./types.ts";

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
      continue;
    }
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export class PlatformClient {
  constructor(
    private readonly configuredBaseUrl?: string,
    private readonly configuredApiKey?: string,
    private readonly audit?: AuditAction,
  ) {}

  private get baseUrl() { return this.configuredBaseUrl ?? env.platformApiBaseUrl; }
  private get apiKey() { return this.configuredApiKey ?? env.platformApiKey; }

  async health(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/health`);
    return (await response.json()) as { status: string };
  }

  clinic(): Promise<ClinicCatalog> {
    return this.get("/api/v1/clinic");
  }

  directory(query: DirectoryQuery): Promise<DirectoryResponse> {
    return this.get(`/api/v1/directory${queryString(query)}`);
  }

  appointments(
    patientId: string,
    when: AppointmentWindow = "upcoming",
  ): Promise<{ appointments: Appointment[] }> {
    return this.get(
      `/api/v1/patients/${encodeURIComponent(patientId)}/appointments${queryString({ when })}`,
    );
  }

  availability(query: AvailabilityQuery): Promise<AvailabilityResponse> {
    const { insurer, ...rest } = query;
    return this.get(`/api/v1/availability${queryString({ ...rest, insurer })}`);
  }

  submitBook(body: BookRequest): Promise<SubmitResponse> {
    return this.post("/api/v1/submit/book", body);
  }

  submitRegister(body: RegisterRequest): Promise<SubmitResponse> {
    return this.post("/api/v1/submit/register", body);
  }

  submitReschedule(body: RescheduleRequest): Promise<SubmitResponse> {
    return this.post("/api/v1/submit/reschedule", body);
  }

  submitCancel(body: CancelRequest): Promise<SubmitResponse> {
    return this.post("/api/v1/submit/cancel", body);
  }

  submitNoAction(body: ReasonRequest): Promise<SubmitResponse> {
    return this.post("/api/v1/submit/no-action", body);
  }

  submitEscalate(body: ReasonRequest): Promise<SubmitResponse> {
    return this.post("/api/v1/submit/escalate", body);
  }

  submissions(limit = 50): Promise<{ submissions: unknown[] }> {
    return this.get(`/api/v1/submissions${queryString({ limit: String(limit) })}`);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
      const requestId = crypto.randomUUID();
      const started = Date.now();
      const url = new URL(`${this.baseUrl}${path}`);
      // Store structured query/body data; authorization headers are never recorded.
      const request = {
        requestId, attempt: attempt + 1, provider: "prosper", method: init.method ?? "GET",
        path: url.pathname.replace(/\/patients\/[^/]+/, "/patients/[patient_id]"),
        query: Object.fromEntries(url.searchParams),
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      };
      await this.audit?.("api.requested", request);
      let response: Response;
      let payload: unknown;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: { "X-Api-Key": this.apiKey, ...init.headers },
          signal: init.signal ?? AbortSignal.timeout(8_000),
        });
        payload = await response.json().catch(() => null);
      } catch (error) {
        await this.audit?.("api.failed", {
          requestId, provider: "prosper", latencyMs: Date.now() - started,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        lastError = error;
        continue;
      }
      // Audit failures must not retry a successfully executed provider action.
      await this.audit?.("api.completed", {
        requestId, provider: "prosper", status: response.status,
        latencyMs: Date.now() - started, result: payload,
      });
      if (response.ok) return payload as T;
      lastError = new PlatformApiError(response.status, path, payload);
      if (response.status !== 429 && response.status !== 502 && response.status !== 503) throw lastError;
    }
    throw lastError;
  }
}

export const platform = new PlatformClient();
