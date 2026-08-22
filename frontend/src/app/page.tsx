import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  BrainCircuitIcon,
  DatabaseZapIcon,
  FileUpIcon,
  LockIcon,
  MessagesSquareIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: FileUpIcon,
    title: "Upload",
    description:
      "Drop PDFs, Word files, spreadsheets or images. DocSage extracts text, tables and image parts, then tracks each document through the pipeline.",
  },
  {
    icon: BrainCircuitIcon,
    title: "Enrich",
    description:
      "Agentic passes write a summary, keywords and hypothetical questions into every chunk's embedding context — retrieval finds what plain text search misses.",
  },
  {
    icon: MessagesSquareIcon,
    title: "Ask",
    description:
      "Questions stream back over SSE with the answer token by token, grounded strictly in your passages and cited [n] to the source page.",
  },
];

const FEATURES = [
  {
    icon: SparklesIcon,
    title: "Agentic enrichment",
    description:
      "LLM passes generate summaries, keywords and hypothetical questions per document; vision captions describe images before anything is embedded.",
  },
  {
    icon: DatabaseZapIcon,
    title: "Dual embedding providers",
    description:
      "Gemini and OpenAI embeddings coexist, each in a 1536-dim pgvector space. Mixed candidate sets embed the query per provider and merge by cosine score.",
  },
  {
    icon: BookOpenCheckIcon,
    title: "SME approval hierarchy",
    description:
      "Library documents wait as pending until a subject-matter expert for their topic approves them — then they become searchable agency-wide.",
  },
  {
    icon: LockIcon,
    title: "Per-user isolation",
    description:
      "Personal documents are visible to their owner alone. Sessions are opaque tokens in HttpOnly cookies; every query is scoped before it runs.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Admin cross-search",
    description:
      "Admins can open a cross-search conversation across every owner and document state — with scope badges making the blast radius explicit.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Logo className="size-7" />
            <span className="font-display text-lg font-semibold tracking-tight">DocSage</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="ds-grid relative overflow-hidden">
          <div className="ds-aurora absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-24 text-center sm:px-6 sm:py-32">
            <Badge variant="outline" className="mb-6 gap-1.5 bg-card/60 py-1 text-xs backdrop-blur">
              <SparklesIcon className="size-3 text-primary" aria-hidden />
              Agentic RAG · FastAPI · pgvector
            </Badge>
            <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
              Your documents,{" "}
              <span className="relative inline-block text-primary italic">
                distilled
                <svg
                  viewBox="0 0 220 12"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="absolute -bottom-1 left-0 h-2.5 w-full text-primary/50"
                >
                  <path
                    d="M3 9c40-6 140-8 214-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>{" "}
              into answers you can verify.
            </h1>
            <p className="mt-6 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
              DocSage ingests your PDFs, decks and spreadsheets, enriches them with agentic passes,
              and answers questions with streaming, cited responses — every claim traceable to the
              passage it came from.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-1.5">
                <Link href="/login">
                  Start chatting
                  <ArrowRightIcon aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#how-it-works">How it works</Link>
              </Button>
            </div>
            <p className="mt-8 font-mono text-xs text-muted-foreground/80">
              postgres 17 · pgvector HNSW · SSE streaming · cookie sessions
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-16 border-t border-border/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto mb-12 max-w-xl text-center">
              <h2 className="font-display text-3xl font-semibold tracking-tight">
                Three steps to a grounded answer
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                The pipeline is fully asynchronous — documents move from queued to ready while you
                keep working.
              </p>
            </div>
            <ol className="grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="relative rounded-xl border bg-card p-6 shadow-sm">
                    <span
                      className="font-display absolute top-5 right-5 text-4xl font-semibold text-primary/15 select-none"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="mb-4 grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-display text-lg font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto mb-12 max-w-xl text-center">
              <h2 className="font-display text-3xl font-semibold tracking-tight">
                Built like production RAG
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                The details that separate a demo from a system: provider isolation, review gates and
                honest citations.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className="group rounded-xl border bg-card p-6 shadow-sm transition-colors hover:border-primary/35"
                  >
                    <span className="mb-4 grid size-10 place-items-center rounded-lg bg-primary/12 text-primary transition-transform group-hover:scale-105">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-display text-lg font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <p className="flex items-center gap-2">
            <Logo className="size-5" />
            <span className="font-display font-semibold text-foreground">DocSage</span>
          </p>
          <p>DocSage — portfolio project by Alex Torres</p>
        </div>
      </footer>
    </div>
  );
}
