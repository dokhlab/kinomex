"use client";

import { useEffect, useState } from "react";
import type { CatalogAccounting } from "@/lib/catalog/types";

export type AccountingState = { status: "loading" } | { status: "ready"; data: CatalogAccounting } | { status: "unavailable" };

// Every count on the documentation page comes from the catalog accounting endpoint.
export function useAccounting(): AccountingState {
  const [state, setState] = useState<AccountingState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetch("/api/catalog/accounting")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((data: CatalogAccounting) => active && setState({ status: "ready", data }))
      .catch(() => active && setState({ status: "unavailable" }));
    return () => {
      active = false;
    };
  }, []);
  return state;
}

export function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "unavailable" : n.toLocaleString("en-US");
}
