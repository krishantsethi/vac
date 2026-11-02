"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateIN } from "@/lib/utils";

interface DataTableProps<T extends Record<string, any>> {
  columns: { key: string; label: string; render?: (val: any, row: T) => React.ReactNode }[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
}

export function DataTable<T extends Record<string, any>>({ columns, data, loading, emptyMessage = "No records found." }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useCallback(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av instanceof Date) av = av.getTime();
      if (bv instanceof Date) bv = bv.getTime();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const rows = sorted();

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 mb-3 rounded bg-surface/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-12 text-center">
        <p className="text-text-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-border/50 bg-navy-secondary/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 font-medium text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:bg-surface/30"
                onClick={() => {
                  if (sortKey === col.key) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(col.key); setSortDir("asc"); }
                }}
              >
                {col.label}
                {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface/30 transition-colors group">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 border-b border-border/50">
                  {col.render ? col.render(col.key === "id" ? row.id : row[col.key], row) : (
                    <span className="text-text">{String(col.key === "id" ? row.id : row[col.key])}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
