import { ClinicApiError } from "./errors";
import type {
  Appointment,
  AppointmentWindow,
  AvailabilityQuery,
  AvailabilityResponse,
  BookRequest,
  CancelRequest,
  ClinicCatalog,
  ClinicSource,
  ClinicSourceInfo,
  DirectoryQuery,
  DirectoryResponse,
  ReasonRequest,
  RegisterRequest,
  RescheduleRequest,
  SubmitResponse,
} from "./types";

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
      continue;
    }
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export type HttpClinicOptions = {
  name?: string;
  baseUrl: string;
  apiKey: string;
  apiKeyHeader?: string;
};

export class HttpClinicSource implements ClinicSource {
  readonly info: ClinicSourceInfo;

  constructor(private readonly options: HttpClinicOptions) {
    this.info = {
      id: "rest",
      name: options.name ?? "Connected clinic",
      kind: "rest",
      baseUrl: options.baseUrl.replace(/\/$/, ""),
    };
  }

  health(): Promise<{ ok: boolean; detail?: string }> {
    return this.get<{ status?: string }>("/api/v1/health")
      .then((body) => ({ ok: true, detail: body.status }))
      .catch((error: unknown) => ({
        ok: false,
        detail: error instanceof Error ? error.message : "health failed",
      }));
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

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.options.apiKey) {
      throw new Error("Missing clinic API key");
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** (attempt - 1)));
      }
      const response = await fetch(`${this.info.baseUrl}${path}`, {
        ...init,
        headers: {
          [this.options.apiKeyHeader ?? "X-Api-Key"]: this.options.apiKey,
          Accept: "application/json",
          ...init.headers,
        },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok) return payload as T;
      lastError = new ClinicApiError(response.status, path, payload);
      if (response.status !== 429 && response.status !== 502 && response.status !== 503) {
        throw lastError;
      }
    }
    throw lastError;
  }
}
