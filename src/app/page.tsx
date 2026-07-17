"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Github,
  Languages,
  Sparkles,
  FileText,
  Film,
  BookOpen,
  Crown,
  Shield,
  LogOut,
  Loader2,
} from "lucide-react";
import { MovieSearch } from "@/components/movie-search";
import type { AiSearchResult } from "@/components/movie-search";
import { MovieContextCard } from "@/components/movie-context-card";
import { ResearchPanel } from "@/components/research-panel";
import { GlossaryEditor } from "@/components/glossary-editor";
import { SubtitleWorkspace } from "@/components/subtitle-workspace";
import { AuthCard } from "@/components/auth-card";
import { AdminPanel } from "@/components/admin-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useUsage } from "@/hooks/use-usage";
import type { TmdbSearchResult, TranslationContextBundle } from "@/lib/tmdb";
import type { ResearchBrief } from "@/lib/translate-context";

type View = "landing" | "login" | "signup" | "app" | "admin";

function viewFromHash(): View {
  const h = window.location.hash.replace("#", "");
  if (h === "login") return "login";
  if (h === "signup") return "signup";
  if (h === "admin") return "admin";
  if (h === "app") return "app";
  return "landing";
}

function setView(v: View) {
  if (typeof window === "undefined") return;
  if (v === "landing") {
    history.replaceState(null, "", window.location.pathname);
  } else {
    history.replaceState(null, "", `#${v}`);
  }
}

function synthIdForAi(title: string, year: string): number {
  let h = 0;
  const s = `${title}|${year}`.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return -Math.abs(h) - 1;
}

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const { status: usage, refresh: refreshUsage } = useUsage(user?.id);

  const [view, setViewState] = useState<View>(() =>
    typeof window === "undefined" ? "landing" : viewFromHash()
  );
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  // Listen for hash changes (e.g. back button).
  useEffect(() => {
    const onHashChange = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Auto-route based on auth state — derive instead of effect-ful setState.
  const effectiveView: View = (!user && (view === "app" || view === "admin"))
    ? "landing"
    : view;

  function changeView(v: View) {
    setViewState(v);
    setView(v);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // --- Admin view ---
  if (effectiveView === "admin" && user?.role === "ADMIN") {
    return <AdminPanel onBack={() => changeView("app")} />;
  }
  if (effectiveView === "admin" && user && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center">
        <Card className="p-8 max-w-md">
          <Shield className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-xl font-bold mb-2">Admin access required</h1>
          <p className="text-sm text-muted-foreground mb-4">
            You need an admin account to view this page.
          </p>
          <Button onClick={() => changeView("app")}>Back to app</Button>
        </Card>
      </div>
    );
  }

  // --- Auth views ---
  if (effectiveView === "login" || effectiveView === "signup") {
    if (user) {
      // Already logged in — show app instead.
      return (
        <App
          user={user}
          usage={usage}
          onLogout={async () => {
            await logout();
            changeView("landing");
          }}
          onUsageChanged={refreshUsage}
          onGoAdmin={() => changeView("admin")}
        />
      );
    }
    return (
      <AuthCard
        mode={authMode}
        onModeChange={setAuthMode}
        onBack={() => changeView("landing")}
      />
    );
  }

  // --- Landing (logged out) ---
  if (!user) {
    return <Landing onGetStarted={() => {
      setAuthMode("signup");
      changeView("signup");
    }} onLogin={() => {
      setAuthMode("login");
      changeView("login");
    }} />;
  }

  // --- App (logged in) ---
  return (
    <App
      user={user}
      usage={usage}
      onLogout={async () => {
        await logout();
        changeView("landing");
      }}
      onUsageChanged={refreshUsage}
      onGoAdmin={() => changeView("admin")}
    />
  );
}

// ── Landing page ──────────────────────────────────────────────────────────

function Landing({
  onGetStarted,
  onLogin,
}: {
  onGetStarted: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Languages className="h-4 w-4" />
            </div>
            <div className="font-semibold">SubSinhala</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onLogin}>
              Log in
            </Button>
            <Button size="sm" onClick={onGetStarted}>
              Get started
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-16 sm:py-24 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Sinhala subtitles that{" "}
          <span className="text-primary">actually fit the movie.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground text-base sm:text-lg">
          SubSinhala studies the movie&apos;s plot, characters, and culture
          first — then locks consistent Sinhala terminology so every line
          sounds right, from opening scene to closing credits.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={onGetStarted} className="gap-2">
            Start translating
            <Sparkles className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" onClick={onLogin}>
            I have an account
          </Button>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          <Feature
            icon={<Film className="h-5 w-5" />}
            title="Knows the movie"
            desc="Pulls plot, cast, characters, and tone from TMDB before translating a single line."
          />
          <Feature
            icon={<BookOpen className="h-5 w-5" />}
            title="Locked terminology"
            desc="Character names, locations, and recurring phrases stay consistent across the whole file."
          />
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="Fine-tune per line"
            desc="Re-translate any cue with an instruction like &quot;make it shorter&quot; or &quot;use formal register&quot;."
          />
        </div>

        <div className="mt-16">
          <Card className="inline-block p-6 max-w-md">
            <div className="text-sm text-muted-foreground mb-1">Free tier</div>
            <div className="text-2xl font-bold">1 subtitle / day</div>
            <div className="text-sm text-muted-foreground mt-1">
              No credit card needed. Premium users get unlimited translations.
            </div>
          </Card>
        </div>
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto max-w-7xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>Built with Next.js · TMDB · DeepSeek</div>
          <Link
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 hover:opacity-80"
            title="This product uses the TMDB API but is not endorsed or certified by TMDB."
          >
            <span className="text-[10px] uppercase tracking-wide">Powered by</span>
            <img
              src="/tmdb-logo.svg"
              alt="The Movie Database (TMDB)"
              className="h-5 w-auto"
            />
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary mb-3">
        {icon}
      </div>
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-sm text-muted-foreground">{desc}</div>
    </Card>
  );
}

// ── Main app view ─────────────────────────────────────────────────────────

interface AppProps {
  user: { id: string; email: string; name: string | null; role: "FREE" | "PREMIUM" | "ADMIN" };
  usage: {
    role: "FREE" | "PREMIUM" | "ADMIN";
    limit: number;
    usedToday: number;
    remaining: number;
    unlimited: boolean;
  } | null;
  onLogout: () => void;
  onUsageChanged: () => void;
  onGoAdmin: () => void;
}

function App({ user, usage, onLogout, onUsageChanged, onGoAdmin }: AppProps) {
  const [selected, setSelected] = useState<{
    id: number;
    media_type: "movie" | "tv";
    source: "tmdb" | "ai";
  } | null>(null);
  const [context, setContext] = useState<TranslationContextBundle | null>(null);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [briefVersion, setBriefVersion] = useState(0);

  function handlePick(
    r: TmdbSearchResult | AiSearchResult,
    ctx: TranslationContextBundle,
    source: "tmdb" | "ai"
  ) {
    const id = source === "ai" ? synthIdForAi(ctx.title, ctx.release_year) : r.id;
    setSelected({ id, media_type: r.media_type, source });
    setContext(ctx);
    setBrief(null);
    setBriefVersion((v) => v + 1);
  }

  function clearMovie() {
    setSelected(null);
    setContext(null);
    setBrief(null);
    setBriefVersion((v) => v + 1);
  }

  function handleBriefReady(b: ResearchBrief) {
    setBrief(b);
    setBriefVersion((v) => v + 1);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Languages className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold leading-tight">SubSinhala</div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {user.email}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {usage && <UsageBadge usage={usage} />}
            {user.role === "ADMIN" && (
              <Button variant="outline" size="sm" onClick={onGoAdmin} className="gap-1">
                <Shield className="h-4 w-4" />
                Admin
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1">
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
        {/* Step 1: pick movie */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <SectionLabel num={1} icon={<Film className="h-4 w-4" />}>
              Find the movie or TV show
            </SectionLabel>
            <MovieSearch onPick={handlePick} selected={selected} />
          </div>
          <div className="space-y-3">
            <SectionLabel num={2} icon={<FileText className="h-4 w-4" />}>
              Selected
            </SectionLabel>
            {context ? (
              <MovieContextCard
                ctx={context}
                onClear={clearMovie}
                source={selected?.source}
              />
            ) : (
              <Card className="p-6 text-sm text-muted-foreground text-center">
                Pick a title to get started.
              </Card>
            )}
          </div>
        </section>

        {/* Step 2: research */}
        <section className="space-y-3">
          <SectionLabel num={3} icon={<Sparkles className="h-4 w-4" />}>
            Research
          </SectionLabel>
          <div className="h-[24rem]">
            <ResearchPanel
              context={context}
              tmdbId={selected?.id ?? null}
              tmdbMediaType={selected?.media_type ?? null}
              onBriefReady={handleBriefReady}
              onBriefVersionChange={setBriefVersion}
            />
          </div>
        </section>

        {/* Step 3: glossary */}
        <section className="space-y-3">
          <SectionLabel num={4} icon={<BookOpen className="h-4 w-4" />}>
            Glossary
          </SectionLabel>
          <div className="h-[24rem]">
            <GlossaryEditor
              context={context}
              brief={brief}
              tmdbId={selected?.id ?? null}
              tmdbMediaType={selected?.media_type ?? null}
              briefVersion={briefVersion}
            />
          </div>
        </section>

        {/* Step 4: subtitles */}
        <section className="space-y-3">
          <SectionLabel num={5} icon={<FileText className="h-4 w-4" />}>
            Subtitles
          </SectionLabel>
          <div className="h-[28rem]">
            <SubtitleWorkspace
              context={context}
              brief={brief}
              tmdbId={selected?.id ?? null}
              tmdbMediaType={selected?.media_type ?? null}
              onTranslationComplete={onUsageChanged}
            />
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto max-w-7xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>Built with Next.js · TMDB · DeepSeek</div>
          <Link
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 hover:opacity-80"
            title="This product uses the TMDB API but is not endorsed or certified by TMDB."
          >
            <span className="text-[10px] uppercase tracking-wide">Powered by</span>
            <img
              src="/tmdb-logo.svg"
              alt="The Movie Database (TMDB)"
              className="h-5 w-auto"
            />
          </Link>
        </div>
      </footer>
    </div>
  );
}

function UsageBadge({
  usage,
}: {
  usage: {
    role: "FREE" | "PREMIUM" | "ADMIN";
    limit: number;
    usedToday: number;
    remaining: number;
    unlimited: boolean;
  };
}) {
  if (usage.unlimited) {
    return (
      <Badge variant="outline" className="gap-1 bg-amber-50 dark:bg-amber-950/30">
        <Crown className="h-3 w-3" />
        {usage.role === "ADMIN" ? "Admin" : "Premium"} · Unlimited
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={usage.remaining > 0 ? "" : "bg-red-50 dark:bg-red-950/30"}
    >
      {usage.remaining} / {usage.limit} left today
    </Badge>
  );
}

function SectionLabel({
  num,
  icon,
  children,
}: {
  num: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
        {num}
      </span>
      <span className="flex items-center gap-1 text-sm font-semibold">
        {icon}
        {children}
      </span>
    </div>
  );
}
