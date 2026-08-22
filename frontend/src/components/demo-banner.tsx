"use client";

import { TriangleAlertIcon } from "lucide-react";

import { useHealth } from "@/components/providers/health-provider";

/** Subtle amber strip shown when the backend runs without provider keys. */
export function DemoBanner() {
  const { demoMode } = useHealth();
  if (!demoMode) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-700 dark:text-amber-300"
    >
      <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Demo mode</span> — no provider keys configured; answers are
        extractive from retrieved passages.
      </p>
    </div>
  );
}
