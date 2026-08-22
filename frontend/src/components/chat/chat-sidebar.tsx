"use client";

import { Loader2Icon, PlusIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/lib/types";

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeId: string | null;
  loading: boolean;
  error: boolean;
  isAdmin: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewAdmin: () => void;
  onRetry: () => void;
}

/** Conversation list with new-conversation actions. Rendered inside a drawer on mobile. */
export function ChatSidebar({
  sessions,
  activeId,
  loading,
  error,
  isAdmin,
  onSelect,
  onNew,
  onNewAdmin,
  onRetry,
}: ChatSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="space-y-1.5">
        <Button className="w-full justify-start" onClick={onNew}>
          <PlusIcon aria-hidden />
          New conversation
        </Button>
        {isAdmin && (
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={onNewAdmin}>
            <ShieldCheckIcon aria-hidden />
            Admin cross-search
          </Button>
        )}
      </div>

      <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Conversations
      </p>

      <nav className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1" aria-label="Conversations">
        {loading ? (
          <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            Loading…
          </p>
        ) : error ? (
          <div className="space-y-2 px-2 py-3">
            <p className="text-sm text-muted-foreground">Could not load conversations.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            No conversations yet — ask your first question below.
          </p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              aria-current={session.id === activeId ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                session.id === activeId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {session.scope === "admin" ? (
                <ShieldCheckIcon className="size-3.5 shrink-0 text-primary" aria-label="Admin scope" />
              ) : (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-current opacity-40"
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{session.title}</span>
                <span className="block text-xs font-normal opacity-70">
                  {new Date(session.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  {session.scope === "admin" && " · admin"}
                </span>
              </span>
            </button>
          ))
        )}
      </nav>

      <div className="border-t border-border/70 px-1 pt-2">
        <Badge variant="outline" className="text-muted-foreground">
          Personal workspace
        </Badge>
      </div>
    </div>
  );
}
