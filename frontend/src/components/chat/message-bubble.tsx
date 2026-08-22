"use client";

import { SparklesIcon } from "lucide-react";

import { CitationChips } from "@/components/citation-chips";
import { Logo } from "@/components/logo";
import { MarkdownLite } from "@/components/markdown-lite";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

/** One turn in the transcript: user right, assistant left with citations. */
export function MessageBubble({ message, streaming = false }: { message: ChatMessage; streaming?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/25 bg-accent px-4 py-2.5 text-sm whitespace-pre-wrap text-accent-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Logo className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <SparklesIcon className="size-3 text-primary" aria-hidden />
          DocSage
        </p>
        <div
          className={cn(
            "rounded-2xl rounded-tl-md border border-border/70 bg-card px-4 py-3 text-sm",
            streaming && "ds-caret",
          )}
        >
          {message.content ? (
            <MarkdownLite content={message.content} />
          ) : streaming ? (
            <span className="sr-only">Generating answer</span>
          ) : (
            <span className="text-muted-foreground">This answer is empty.</span>
          )}
        </div>
        <CitationChips citations={message.citations} />
      </div>
    </div>
  );
}
