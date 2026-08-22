"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelLeftIcon, ShieldCheckIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { Composer } from "@/components/chat/composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { WelcomeState } from "@/components/chat/welcome-state";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  createChatSession,
  listChatMessages,
  listChatSessions,
  streamChatMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatScope, ChatSession, Citation } from "@/lib/types";

/** Sidebar title, derived client-side from the first user message. */
function titleFrom(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 42) return trimmed;
  const cut = trimmed.slice(0, 42);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?";
}

export default function ChatPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamCitations, setStreamCitations] = useState<Citation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const isAdmin = user?.role === "admin";

  // Conversation list: fetched on mount and whenever the user retries.
  useEffect(() => {
    let cancelled = false;
    listChatSessions()
      .then((items) => {
        if (cancelled) return;
        items.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setSessions(items);
        setActiveId((current) => current ?? items[0]?.id ?? null);
        if (items.length > 0) setMessagesLoading(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setSessionsError(true);
        toast.error("Conversations unavailable", { description: describeError(err) });
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Transcript for the selected conversation. The synchronous reset happens in
  // the selection handlers; this effect only awaits and replaces.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    listChatMessages(activeId)
      .then((items) => {
        if (!cancelled) setMessages(items);
      })
      .catch((err) => {
        if (!cancelled) toast.error("Conversation unavailable", { description: describeError(err) });
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Abort any in-flight stream when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Auto-scroll follows new tokens unless the reader scrolled away.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, messagesLoading, streaming, streamText]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }

  const ensureSession = useCallback(async (scope: ChatScope): Promise<string> => {
    const session = await createChatSession(scope);
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    setMessages([]);
    setMessagesLoading(false);
    return session.id;
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (streaming) return;
      let sessionId = activeId;
      if (!sessionId) {
        try {
          sessionId = await ensureSession("personal");
        } catch (err) {
          toast.error("Could not start a conversation", { description: describeError(err) });
          return;
        }
      }
      const sid = sessionId;

      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: "user",
          content,
          citations: [],
          created_at: new Date().toISOString(),
        },
      ]);
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sid && (!session.title.trim() || session.title === "New conversation")
            ? { ...session, title: titleFrom(content) }
            : session,
        ),
      );
      stickToBottomRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setStreamText("");
      setStreamCitations([]);

      let accumulated = "";
      let citations: Citation[] = [];
      let finalId = "";
      let streamError: string | null = null;

      try {
        await streamChatMessage(
          sid,
          content,
          (event) => {
            if (event.type === "delta") {
              accumulated += event.text;
              setStreamText(accumulated);
            } else if (event.type === "citations") {
              citations = event.citations;
              setStreamCitations(citations);
            } else if (event.type === "done") {
              finalId = event.message_id;
            } else if (event.type === "error") {
              streamError = event.message;
            }
          },
          controller.signal,
        );
        setMessages((prev) => [
          ...prev,
          {
            id: finalId || `assistant-${Date.now()}`,
            role: "assistant",
            content: accumulated,
            citations,
            created_at: new Date().toISOString(),
          },
        ]);
        if (streamError) {
          toast.error("Stream interrupted", { description: streamError });
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Reader stopped generation: keep whatever streamed so far.
          if (accumulated) {
            setMessages((prev) => [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: accumulated,
                citations,
                created_at: new Date().toISOString(),
              },
            ]);
          }
        } else if (err instanceof ApiError && err.status === 401) {
          toast.error("Session expired", { description: "Please sign in again." });
          await signOut();
          router.push("/login");
          return;
        } else {
          toast.error("Answer failed", { description: describeError(err) });
        }
      } finally {
        setStreaming(false);
        setStreamText("");
        setStreamCitations([]);
        abortRef.current = null;
      }
    },
    [activeId, streaming, ensureSession, signOut, router],
  );

  async function handleNew(scope: ChatScope) {
    try {
      await ensureSession(scope);
      setSidebarOpen(false);
    } catch (err) {
      toast.error("Could not start a conversation", { description: describeError(err) });
    }
  }

  function handleSelect(id: string) {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    setMessagesLoading(true);
    stickToBottomRef.current = true;
    setActiveId(id);
    setSidebarOpen(false);
  }

  const showWelcome = !messagesLoading && messages.length === 0 && !streaming;

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Conversations"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 shrink-0 border-r border-border bg-background transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b border-border/70 px-4 md:justify-center">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Chat history
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto md:hidden"
            aria-label="Close conversations"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftIcon aria-hidden />
          </Button>
        </div>
        <div className="h-[calc(100%-3rem)]">
          <ChatSidebar
            sessions={sessions}
            activeId={activeId}
            loading={sessionsLoading}
            error={sessionsError}
            isAdmin={isAdmin}
            onSelect={handleSelect}
            onNew={() => void handleNew("personal")}
            onNewAdmin={() => void handleNew("admin")}
            onRetry={() => {
              setSessionsError(false);
              setSessionsLoading(true);
              setReloadToken((token) => token + 1);
            }}
          />
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Conversation">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Open conversations"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeftIcon aria-hidden />
          </Button>
          <p className="min-w-0 truncate text-sm font-medium">
            {activeSession?.title ?? "New conversation"}
          </p>
          {activeSession?.scope === "admin" ? (
            <Badge variant="warning" className="ml-1 shrink-0">
              <ShieldCheckIcon aria-hidden />
              Admin · all documents
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1 shrink-0 text-muted-foreground">
              <UserIcon aria-hidden />
              Personal scope
            </Badge>
          )}
        </header>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto"
          role="log"
          aria-live="polite"
          aria-label="Messages"
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messagesLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading conversation…</p>
            ) : showWelcome ? (
              <WelcomeState onAsk={(question) => void send(question)} />
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
            {streaming && (
              <MessageBubble
                streaming
                message={{
                  id: "__streaming__",
                  role: "assistant",
                  content: streamText,
                  citations: streamCitations,
                  created_at: "",
                }}
              />
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border/70 bg-background/85 px-4 py-3 backdrop-blur-sm">
          <Composer
            streaming={streaming}
            onSend={(content) => void send(content)}
            onStop={() => abortRef.current?.abort()}
          />
        </div>
      </section>
    </div>
  );
}
