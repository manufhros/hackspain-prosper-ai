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
};

// Con TanStack Query, en el polling de runs:
//   useQuery({
//     queryKey: ["team"],
//     queryFn: prosper.team,
//     refetchInterval: (q) => (q.state.data?.runs.some((r) => r.state === "running") ? 5000 : false),
//   });
