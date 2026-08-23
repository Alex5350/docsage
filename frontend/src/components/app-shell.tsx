"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MessageSquareIcon,
  TagsIcon,
  UploadCloudIcon,
  FolderOpenIcon,
} from "lucide-react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/components/providers/auth-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listPendingReviews } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof MessageSquareIcon;
  /** Optional pending-count chip (reviews). */
  count?: number;
}

/** Application chrome: brand, primary nav, user menu, theme toggle. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);

  const isAdmin = user?.role === "admin";

  // Cheap probe on sign-in + each navigation: shows the Reviews entry to SMEs
  // (non-empty queue) and admins regardless. Failures (incl. 403 for members
  // without designations) simply hide the item.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listPendingReviews()
      .then((items) => {
        if (!cancelled) setPendingReviews(items.length);
      })
      .catch(() => {
        if (!cancelled) setPendingReviews(0);
      });
    return () => {
      cancelled = true;
    };
  }, [user, pathname]);

  const nav: NavItem[] = [
    { href: "/chat", label: "Chat", icon: MessageSquareIcon },
    { href: "/upload", label: "Upload", icon: UploadCloudIcon },
    { href: "/documents", label: "Documents", icon: FolderOpenIcon },
    ...(isAdmin || pendingReviews > 0
      ? [{ href: "/reviews", label: "Reviews", icon: ClipboardCheckIcon, count: pendingReviews }]
      : []),
    // /admin/topics nests under /admin — the longest matching href wins the
    // active highlight below so only one item lights up at a time.
    ...(isAdmin ? [{ href: "/admin/topics", label: "Topics", icon: TagsIcon }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: LayoutDashboardIcon }] : []),
  ];

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/login");
    } finally {
      setSigningOut(false);
    }
  }

  // The longest matching href is the active one (a nested route outranks its
  // section root, e.g. /admin/topics over /admin).
  const activeHref = nav
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .reduce<string | null>(
      (best, item) => (best === null || item.href.length > best.length ? item.href : best),
      null,
    );

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/chat" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
            <Logo className="size-7" />
            <span className="font-display text-lg font-semibold tracking-tight">DocSage</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={activeHref === item.href ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    activeHref === item.href
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                  {item.count ? (
                    <span
                      aria-label={`${item.count} pending`}
                      className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-px font-mono text-[0.65rem] font-semibold text-primary"
                    >
                      {item.count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />

            {/* Mobile nav */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
                  <MenuIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 md:hidden">
                {nav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} aria-current={activeHref === item.href ? "page" : undefined}>
                        <Icon aria-hidden />
                        {item.label}
                        {item.count ? (
                          <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-px font-mono text-[0.65rem] font-semibold text-primary">
                            {item.count}
                          </span>
                        ) : null}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open user menu"
                  className="rounded-full transition-opacity hover:opacity-85 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <Avatar>
                    <AvatarFallback className="bg-primary/15 text-primary">
                      {(user?.display_name ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-foreground">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {user?.display_name}
                  </span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {user?.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Badge variant={user?.role === "admin" ? "default" : "secondary"} className="pointer-events-none">
                    {user?.role === "admin" ? "Administrator" : "Member"}
                  </Badge>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={signingOut}
                  onSelect={() => void handleSignOut()}
                >
                  <LogOutIcon aria-hidden />
                  {signingOut ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Pages own their scrolling: add `overflow-y-auto` on the page root for
          regular pages, or internal panes for app-like layouts (chat). */}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
