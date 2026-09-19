"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

function useListState() {
  const [tab, setTab] = useState("__all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  return { tab, setTab, query, setQuery, page, setPage };
}

const CallListContext = createContext<ReturnType<typeof useListState> | null>(null);

export function CallListState({ children }: { children: ReactNode }) {
  const state = useListState();
  return <CallListContext.Provider value={state}>{children}</CallListContext.Provider>;
}

export function useCallListState() {
  const state = useContext(CallListContext);
  if (!state) throw new Error("Call list requires its layout state provider");
  return state;
}
