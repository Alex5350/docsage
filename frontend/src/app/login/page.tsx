"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, login, register } from "@/lib/api";

type Mode = "login" | "register";

function LoginCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, refresh } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Straight to the app.
  useEffect(() => {
    if (!loading && user) {
      router.replace("/chat");
    }
  }, [loading, user, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await register({ email, password, display_name: displayName.trim() || email.split("@")[0] });
        toast.success("Account created", { description: `Welcome to DocSage, ${displayName.trim() || email}.` });
      } else {
        await login({ email, password });
      }
      await refresh();
      const next = searchParams.get("next");
      router.push(next && next.startsWith("/") ? next : "/chat");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Is the backend running on port 8000?",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-aurora relative flex min-h-svh flex-col bg-background">
      <div className="flex items-center justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <Logo className="mx-auto mb-4 size-14 drop-shadow-lg drop-shadow-primary/25" />
            <h1 className="font-display text-3xl font-semibold tracking-tight">DocSage</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Agentic document intelligence — grounded answers with citations.
            </p>
          </div>

          <Card className="shadow-xl shadow-black/5">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>{mode === "login" ? "Sign in" : "Create an account"}</CardTitle>
                  <CardDescription>
                    {mode === "login"
                      ? "Access your workspace and conversations."
                      : "A personal workspace with document isolation."}
                  </CardDescription>
                </div>
                <Tabs
                  value={mode}
                  onValueChange={(value) => {
                    setMode(value as Mode);
                    setError(null);
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="login">Sign in</TabsTrigger>
                    <TabsTrigger value="register">Register</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit} noValidate={false}>
                {mode === "register" && (
                  <div className="space-y-2">
                    <Label htmlFor="display-name">Display name</Label>
                    <Input
                      id="display-name"
                      autoComplete="name"
                      placeholder="Alex Torres"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      required
                      maxLength={80}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={8}
                  />
                  {mode === "register" && (
                    <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                  )}
                </div>

                {error && (
                  <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" size="lg" disabled={busy}>
                  {busy ? (
                    "Working…"
                  ) : mode === "login" ? (
                    "Sign in"
                  ) : (
                    <>
                      <SparklesIcon aria-hidden /> Create account
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Sessions use a secure HttpOnly cookie, 30-day expiry.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
