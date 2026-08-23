"use client";

import { CheckIcon, KeyRoundIcon } from "lucide-react";

import { useHealth } from "@/components/providers/health-provider";
import { cn } from "@/lib/utils";
import { PROVIDERS } from "@/lib/providers";
import type { EmbeddingProvider } from "@/lib/types";

/**
 * Embedding provider cards for the upload flow. Providers whose keys are
 * missing (per /api/health) render disabled with a "requires API key" badge;
 * the selected card is highlighted with the teal accent ring.
 */
export function ProviderPicker({
  value,
  onChange,
  idPrefix,
  disabled = false,
}: {
  value: EmbeddingProvider;
  onChange: (provider: EmbeddingProvider) => void;
  /** Uniquifies the radio group per file config card. */
  idPrefix: string;
  disabled?: boolean;
}) {
  const { health } = useHealth();

  return (
    <div
      role="radiogroup"
      aria-label="Embedding provider"
      className="grid gap-2 sm:grid-cols-3"
    >
      {PROVIDERS.map((provider) => {
        const available = !disabled && provider.available(health);
        const selected = value === provider.id;
        return (
          <label
            key={provider.id}
            htmlFor={`${idPrefix}-provider-${provider.id}`}
            aria-disabled={!available}
            className={cn(
              "relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors",
              selected
                ? "border-primary/60 bg-accent/60 ring-[3px] ring-ring/30"
                : "border-border bg-card hover:border-primary/35 hover:bg-muted/40",
              !available && "cursor-not-allowed opacity-60 hover:border-border hover:bg-card",
              "has-focus-visible:ring-[3px] has-focus-visible:ring-ring/40 has-focus-visible:outline-none",
            )}
          >
            <span className="flex w-full items-center gap-2 pr-16">
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {selected ? <CheckIcon className="size-3" /> : null}
              </span>
              <span className="truncate text-sm font-medium">{provider.name}</span>
            </span>
            <span className="line-clamp-2 pr-2 text-xs leading-relaxed text-muted-foreground">
              {provider.blurb}
            </span>
            <span className="font-mono text-[0.65rem] text-muted-foreground/70">{provider.model}</span>

            {!available && (
              <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/12 px-2 py-0.5 text-[0.65rem] font-medium text-amber-700 dark:text-amber-300">
                <KeyRoundIcon className="size-3" aria-hidden />
                requires API key
              </span>
            )}

            <input
              id={`${idPrefix}-provider-${provider.id}`}
              type="radio"
              name={`${idPrefix}-provider`}
              value={provider.id}
              checked={selected}
              disabled={!available}
              onChange={() => onChange(provider.id)}
              className="sr-only"
            />
          </label>
        );
      })}
    </div>
  );
}
