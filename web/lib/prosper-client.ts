import type {
  Board,
  Clinic,
  PatientsPage,
  ProblemDetail,
  ProblemsList,
  ProblemSubmissions,
  RunNotes,
  Session,
  TeamPayload,
} from "./prosper-types";

export class ProsperError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/prosper/${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ProsperError(body?.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const prosper = {
  session: () => get<Session>("session"),
  notes: () => get<RunNotes>("notes"),
  board: () => get<Board>("board"),
  team: () => get<TeamPayload>("team"), // runs, stats, submissions
  problems: () => get<ProblemsList>("problems"),
  problem: (id: string) => get<ProblemDetail>(`problems/${id}`),
  problemSubmissions: (id: string) => get<ProblemSubmissions>(`problems/${id}/submissions`),
  clinic: () => get<Clinic>("clinic"),
  patients: (offset = 0, limit = 50) => get<PatientsPage>(`clinic/patients?offset=${offset}&limit=${limit}`),

  audioUrl: (callId: string) => `/api/prosper/audio/${callId}`,

  // Dispara un Call de un caso público contra un endpoint override (mutación
  // acotada: ver web/app/api/prosper/call/route.ts).
  triggerCall: async (body: { problem_id: string; case_id: string; endpoint: string; headers?: string }) => {
    const res = await fetch("/api/prosper/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProsperError(data?.detail ?? data?.data?.message ?? data?.error ?? `HTTP ${res.status}`, res.status);
    return data as { run_id: string };
  },
};

// Con TanStack Query, en el polling de runs:
//   useQuery({
//     queryKey: ["team"],
//     queryFn: prosper.team,
//     refetchInterval: (q) => (q.state.data?.runs.some((r) => r.state === "running") ? 5000 : false),
//   });
