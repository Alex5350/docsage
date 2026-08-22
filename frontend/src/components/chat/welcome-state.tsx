"use client";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";

const SUGGESTED_QUESTIONS = [
  "Summarize the key points of my uploaded documents",
  "What do my documents say about pricing or budgets?",
  "Which passages mention compliance requirements?",
  "Compare conclusions across my uploaded reports",
];

/** Empty state shown for a fresh conversation. */
export function WelcomeState({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="ds-aurora mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="space-y-3">
        <Logo className="mx-auto size-12 drop-shadow-lg drop-shadow-primary/20" />
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Ask your documents anything
        </h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          DocSage retrieves the most relevant passages from your workspace and answers with citations
          you can verify.
        </p>
      </div>

      <Badge variant="outline" className="text-muted-foreground">
        Answers are grounded in your documents only
      </Badge>

      <div className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onAsk(question)}
            className="rounded-xl border border-border bg-card/70 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
