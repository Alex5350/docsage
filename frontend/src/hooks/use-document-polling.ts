"use client";

import { useEffect, useRef } from "react";

import { getDocument } from "@/lib/api";
import type { DocumentSummary } from "@/lib/types";

export const POLL_INTERVAL_MS = 1500;

/**
 * Polls GET /api/documents/{id} for every id in `ids` until the caller drops
 * the id (i.e. it reached `ready`/`failed` or left the view). Failures are
 * swallowed so a transient blip or a backend restart doesn't kill the loop;
 * pages surface persistent failures through their own list refreshes.
 */
export function useDocumentPolling(
  ids: string[],
  onUpdate: (document: DocumentSummary) => void,
  intervalMs: number = POLL_INTERVAL_MS,
): void {
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // Stable key: restarting the loop only when the tracked set changes.
  const key = ids.join(",");

  useEffect(() => {
    if (!key) return;
    const tracked = key.split(",");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      await Promise.allSettled(
        tracked.map(async (id) => {
          try {
            const document = await getDocument(id);
            if (!cancelled) onUpdateRef.current(document);
          } catch {
            // Keep polling; the next round may succeed.
          }
        }),
      );
      if (!cancelled) timer = setTimeout(() => void tick(), intervalMs);
    };

    timer = setTimeout(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, intervalMs]);
}
