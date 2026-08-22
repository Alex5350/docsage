"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { getHealth } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";

interface HealthContextValue {
  health: HealthStatus | null;
  /** Backend unreachable — the UI degrades gracefully rather than erroring. */
  offline: boolean;
  demoMode: boolean;
}

const HealthContext = createContext<HealthContextValue | null>(null);

/** Probes /api/health once so the demo-mode banner can appear app-wide. */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((status) => {
        if (!cancelled) setHealth(status);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ health, offline, demoMode: health?.demo_mode ?? false }),
    [health, offline],
  );

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthContextValue {
  const context = useContext(HealthContext);
  if (!context) throw new Error("useHealth must be used within HealthProvider");
  return context;
}
