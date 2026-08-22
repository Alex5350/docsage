"use client";

import { useState } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ComposerProps {
  streaming: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

/** Message composer: Enter sends, Shift+Enter inserts a newline. */
export function Composer({ streaming, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState("");

  function submit() {
    const content = value.trim();
    if (!content || streaming) return;
    onSend(content);
    setValue("");
  }

  return (
    <form
      className="mx-auto w-full max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-lg shadow-black/5 transition-colors focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-ring/25">
        <label htmlFor="chat-composer" className="sr-only">
          Ask a question about your documents
        </label>
        <Textarea
          id="chat-composer"
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask anything about your documents…"
          className="max-h-48 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          disabled={streaming}
        />
        {streaming ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Stop generating"
            onClick={onStop}
          >
            <SquareIcon className="size-3.5 fill-current" aria-hidden />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={value.trim().length === 0}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        <kbd className="rounded border border-border bg-muted px-1 font-mono">Enter</kbd> to send ·{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono">Shift+Enter</kbd> for a
        new line · answers cite their sources
      </p>
    </form>
  );
}
