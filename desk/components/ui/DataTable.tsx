"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EmptyState } from "./primitives";
import s from "./ui.module.css";

export type Column = {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: string;
  nowrap?: boolean;
};

export type Row = {
  id: string;
  /** Value matched against the active filter tab. */
  tab?: string;
  /** Lower-cased text used by the search box. */
  search?: string;
  cells: React.ReactNode[];
};

export type TabDef = { value: string; label: string };

export function DataTable({
  columns,
  rows,
  tabs,
  allLabel = "Todas",
  pageSize = 25,
  searchPlaceholder = "Buscar…",
  emptyTitle = "Sin resultados",
  emptyDescription,
  toolbarExtra,
  unit = "filas",
}: {
  columns: Column[];
  rows: Row[];
  tabs?: TabDef[];
  allLabel?: string;
  pageSize?: number;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbarExtra?: React.ReactNode;
  /** Noun used in the footer count, e.g. "citas". */
  unit?: string;
}) {
  const [tab, setTab] = useState<string>("__all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) if (row.tab) map.set(row.tab, (map.get(row.tab) ?? 0) + 1);
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => (tab === "__all" || row.tab === tab) && (!q || (row.search ?? "").includes(q)));
  }, [rows, tab, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);
  const from = filtered.length ? current * pageSize + 1 : 0;
  const to = current * pageSize + visible.length;
  const showToolbar = Boolean(tabs?.length) || rows.length > 8 || toolbarExtra;

  return (
    <>
      {showToolbar ? (
        <div className={s.toolbar}>
          {tabs?.length ? (
            <div className={s.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                className={s.tab}
                data-active={tab === "__all"}
                aria-selected={tab === "__all"}
                onClick={() => {
                  setTab("__all");
                  setPage(0);
                }}
              >
                {allLabel} <b>{rows.length}</b>
              </button>
              {tabs.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  className={s.tab}
                  data-active={tab === item.value}
                  aria-selected={tab === item.value}
                  onClick={() => {
                    setTab(item.value);
                    setPage(0);
                  }}
                >
                  {item.label} <b>{counts.get(item.value) ?? 0}</b>
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          <div className={s.toolbarRight}>
            {toolbarExtra}
            {rows.length > 8 ? (
              <label className={s.search}>
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {visible.length ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} data-align={column.align} style={column.width ? { width: column.width } : undefined}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => (
                    <td key={columns[index]?.key ?? index} data-align={columns[index]?.align} data-nowrap={columns[index]?.nowrap}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      )}

      {filtered.length > pageSize || rows.length !== filtered.length ? (
        <div className={s.tableFoot}>
          <span>
            Mostrando {from}–{to} de {filtered.length} {unit}
            {rows.length !== filtered.length ? ` · ${rows.length} en total` : ""}
          </span>
          {pages > 1 ? (
            <div className={s.pager}>
              <button type="button" aria-label="Página anterior" disabled={current === 0} onClick={() => setPage(current - 1)}>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <span>
                {current + 1} / {pages}
              </span>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
