"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/providers/auth-provider";
import { HealthProvider } from "@/components/providers/health-provider";
import { Toaster } from "@/components/ui/sonner";

/** Client providers: theme (class strategy, dark-first), auth session, health, toasts. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <HealthProvider>
        <AuthProvider>{children}</AuthProvider>
      </HealthProvider>
      <Toaster richColors closeButton />
    </ThemeProvider>
  );
}
