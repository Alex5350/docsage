"use client";

import { useEffect, useState } from "react";
import {
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TagsIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, addTopicSme, createTopic, listTopics, removeTopicSme } from "@/lib/api";
import type { Topic } from "@/lib/types";

// v1 constraint: the REST contract has no user-directory or lookup-by-email
// endpoint, so SMEs are designated by pasting a user id (UUID). A member
// directory (list + search) is the agreed follow-up; until then members can
// read their own id from /auth/me.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_AN_ID_ERROR = "Enter the user's id (a UUID) — the API cannot resolve emails yet.";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?";
}

/** Admin-only management of library topics and their SME designations. */
export default function AdminTopicsPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [smeTarget, setSmeTarget] = useState<Topic | null>(null);
  const [smeInput, setSmeInput] = useState("");
  const [smeError, setSmeError] = useState<string | null>(null);
  const [designating, setDesignating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // Skeletons only on the first load; later reloads (Refresh, mutations) keep
  // the current list rendered while the refetch lands.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listTopics().then(
      (list) => {
        if (cancelled) return;
        setTopics(list);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reloadToken]);

  function openTopicDialog() {
    setTopicName("");
    setTopicDescription("");
    setTopicError(null);
    setTopicDialogOpen(true);
  }

  async function submitTopic() {
    const name = topicName.trim();
    if (!name || creating) return;
    setCreating(true);
    setTopicError(null);
    try {
      const topic = await createTopic({ name, description: topicDescription.trim() || undefined });
      setTopics((prev) => (prev ? [topic, ...prev] : [topic]));
      setTopicDialogOpen(false);
      toast.success("Topic created", {
        description: `“${topic.name}” is ready for library documents.`,
      });
      // Reconcile to the server's name ordering.
      setReloadToken((token) => token + 1);
    } catch (err) {
      setTopicError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  function openSmeDialog(topic: Topic) {
    setSmeTarget(topic);
    setSmeInput("");
    setSmeError(null);
  }

  async function submitSme() {
    if (!smeTarget || designating) return;
    const value = smeInput.trim();
    if (!UUID_PATTERN.test(value)) {
      setSmeError(NOT_AN_ID_ERROR);
      return;
    }
    setDesignating(true);
    setSmeError(null);
    const target = smeTarget;
    try {
      await addTopicSme(target.id, value);
      setSmeTarget(null);
      toast.success("SME designated", {
        description: `“${target.name}” has a new subject-matter reviewer.`,
      });
      setReloadToken((token) => token + 1);
    } catch (err) {
      setSmeError(describeError(err));
    } finally {
      setDesignating(false);
    }
  }

  async function handleRemoveSme(topic: Topic, userId: string) {
    const key = `${topic.id}:${userId}`;
    if (removing !== null) return;
    setRemoving(key);
    try {
      await removeTopicSme(topic.id, userId);
      toast.success("SME removed", { description: `“${topic.name}” lost its reviewer.` });
      setReloadToken((token) => token + 1);
    } catch (err) {
      toast.error("Could not remove SME", { description: describeError(err) });
    } finally {
      setRemoving(null);
    }
  }

  if (!authLoading && !isAdmin) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
          <div className="ds-aurora grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <ShieldCheckIcon className="size-6" aria-hidden />
              </div>
              <h1 className="font-display text-lg font-semibold tracking-tight">Admins only</h1>
              <p className="text-sm text-muted-foreground">
                Topic and SME management is restricted to administrator accounts.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Topics &amp; SMEs</h1>
            <p className="text-sm text-muted-foreground">
              Library topics and the subject-matter experts who approve documents filed under
              them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setReloadToken((token) => token + 1);
              }}
              disabled={loading}
            >
              <RefreshCwIcon aria-hidden />
              Refresh
            </Button>
            <Button size="sm" onClick={openTopicDialog}>
              <PlusIcon aria-hidden />
              New topic
            </Button>
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6"
          >
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setLoading(true);
                setReloadToken((token) => token + 1);
              }}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : loading && !topics ? (
          <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading topics">
            {Array.from({ length: 4 }, (_, index) => (
              <Card key={index} className="gap-4 py-5">
                <CardHeader>
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-3.5 w-3/4" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-3.5 w-32" />
                  <div className="flex gap-2">
                    <Skeleton className="h-7 w-36 rounded-full" />
                    <Skeleton className="h-7 w-28 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !topics || topics.length === 0 ? (
          <div className="ds-aurora grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <TagsIcon className="size-6" aria-hidden />
              </div>
              <h2 className="font-display text-lg font-semibold tracking-tight">No topics yet</h2>
              <p className="text-sm text-muted-foreground">
                Create a topic to organize library documents and designate the SMEs who review
                them.
              </p>
              <Button size="sm" onClick={openTopicDialog}>
                <PlusIcon aria-hidden />
                New topic
              </Button>
            </div>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2" aria-label="Topics">
            {topics.map((topic) => (
              <li key={topic.id}>
                <Card className="gap-4 py-5">
                  <CardHeader>
                    <CardTitle className="text-base">{topic.name}</CardTitle>
                    <CardDescription>{topic.description || "No description."}</CardDescription>
                    <CardAction>
                      <Button variant="outline" size="sm" onClick={() => openSmeDialog(topic)}>
                        <UserPlusIcon aria-hidden />
                        Add SME
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Subject-matter experts
                    </h3>
                    {topic.smes.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                        No SMEs yet — library documents on this topic stay pending until one is
                        designated.
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-2" aria-label={`SMEs for ${topic.name}`}>
                        {topic.smes.map((sme) => {
                          const key = `${topic.id}:${sme.id}`;
                          return (
                            <li
                              key={sme.id}
                              className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-2"
                            >
                              <span className="flex min-w-0 items-center gap-1.5" title={sme.email}>
                                <span
                                  aria-hidden
                                  className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 font-mono text-[0.6rem] font-semibold text-primary"
                                >
                                  {sme.display_name.charAt(0).toUpperCase()}
                                </span>
                                <span className="max-w-45 truncate text-xs font-medium text-foreground">
                                  {sme.display_name}
                                </span>
                                <span className="hidden max-w-45 truncate text-xs text-muted-foreground sm:inline">
                                  {sme.email}
                                </span>
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove ${sme.display_name} from ${topic.name}`}
                                onClick={() => void handleRemoveSme(topic, sme.id)}
                                disabled={removing !== null}
                                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
                              >
                                {removing === key ? (
                                  <Loader2Icon className="size-3 animate-spin" aria-hidden />
                                ) : (
                                  <XIcon className="size-3" aria-hidden />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* -- new topic dialog -------------------------------------------------- */}
      <Dialog
        open={topicDialogOpen}
        onOpenChange={(open) => {
          if (!open && !creating) setTopicDialogOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New topic</DialogTitle>
            <DialogDescription>
              Topics organize library documents and scope which SMEs review them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic-name">
                Name <span className="font-normal text-destructive">(required)</span>
              </Label>
              <Input
                id="topic-name"
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
                placeholder="e.g. Grant Compliance"
                maxLength={200}
                aria-required
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topic-description">Description</Label>
              <Textarea
                id="topic-description"
                value={topicDescription}
                onChange={(event) => setTopicDescription(event.target.value)}
                placeholder="What kinds of documents belong to this topic?"
                maxLength={500}
                disabled={creating}
              />
            </div>
            {topicError ? (
              <p role="alert" className="text-sm text-destructive">
                {topicError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTopicDialogOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submitTopic()} disabled={creating || !topicName.trim()}>
              {creating ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
              {creating ? "Creating…" : "Create topic"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -- add SME dialog ---------------------------------------------------- */}
      <Dialog
        open={smeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !designating) setSmeTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlusIcon className="size-4 text-primary" aria-hidden />
              Add SME
            </DialogTitle>
            <DialogDescription>
              “{smeTarget?.name ?? ""}” — designated SMEs approve library documents filed under
              this topic.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="sme-input">Member id or email</Label>
            <Input
              id="sme-input"
              value={smeInput}
              onChange={(event) => setSmeInput(event.target.value)}
              placeholder="Paste the member's user id (UUID)"
              aria-required
              autoFocus
              disabled={designating}
            />
            <p className="text-xs text-muted-foreground">
              The API resolves user ids only in v1 — every member can copy theirs from{" "}
              <span className="font-mono">/auth/me</span>. Email lookup arrives with a member
              directory.
            </p>
            {smeError ? (
              <p role="alert" className="text-sm text-destructive">
                {smeError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSmeTarget(null)} disabled={designating}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submitSme()} disabled={designating || !smeInput.trim()}>
              {designating ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <UserPlusIcon aria-hidden />
              )}
              {designating ? "Designating…" : "Designate SME"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
