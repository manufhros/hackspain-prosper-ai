"use client";

import { useQuery } from "@tanstack/react-query";
import { prosper } from "./prosper-client";

export const useTeam = () =>
  useQuery({
    queryKey: ["team"],
    queryFn: prosper.team,
    // Polling solo mientras haya algún run en curso
    refetchIntervalInBackground: true,
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.state === "running") ? 5000 : false),
  });

export const useBoard = () => useQuery({ queryKey: ["board"], queryFn: prosper.board });
export const useProblems = () => useQuery({ queryKey: ["problems"], queryFn: prosper.problems });
export const useProblem = (id: string) => useQuery({ queryKey: ["problem", id], queryFn: () => prosper.problem(id) });
export const useProblemSubmissions = (id: string) =>
  useQuery({ queryKey: ["problem-submissions", id], queryFn: () => prosper.problemSubmissions(id) });
export const useClinic = () => useQuery({ queryKey: ["clinic"], queryFn: prosper.clinic, staleTime: 5 * 60_000 });
export const usePatients = (offset: number, limit: number) =>
  useQuery({
    queryKey: ["patients", offset, limit],
    queryFn: () => prosper.patients(offset, limit),
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

export const useRunNotes = () => useQuery({ queryKey: ["run-notes"], queryFn: prosper.notes, staleTime: 60_000 });
