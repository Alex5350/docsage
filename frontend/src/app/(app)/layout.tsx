"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { DemoBanner } from "@/components/demo-banner";
import { useAuth } from "@/components/providers/auth-provider";

/**
 * Protected layout for the (app) route group: waits for the auth probe, then
 * redirects unauthenticated visitors to /login.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-svh place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
          <Loader2Icon className="size-6 animate-spin text-primary" aria-hidden />
          <p className="text-sm">Checking your session…</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <DemoBanner />
      {children}
    </AppShell>
  );
}
