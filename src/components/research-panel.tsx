"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Database,
  CheckCircle2,
} from "lucide-react";
import type { TranslationContextBundle } from "@/lib/tmdb";
import type { ResearchBrief } from "@/lib/translate-context";

interface ResearchPanelProps {
  context: TranslationContextBundle | null;
  tmdbId: number | null;
  tmdbMediaType: "movie" | "tv" | null;
  onBriefReady: (brief: ResearchBrief) => void;
  onBriefVersionChange?: (version: number) => void;
}

type Phase = "idle" | "running" | "done" | "error";

export function ResearchPanel({
  context,
  tmdbId,
  tmdbMediaType,
  onBriefReady,
  onBriefVersionChange,
}: ResearchPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  // Clear any pending state on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // When the selected movie changes, try to load any cached brief.
  const loadFromCache = useCallback(async () => {
    if (!tmdbId || !tmdbMediaType) {
      setPhase("idle");
      setText("");
      setCacheHit(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/brief/get?tmdb_id=${tmdbId}&tmdb_media_type=${tmdbMediaType}`
      );
      if (res.status === 404) {
        setPhase("idle");
        setText("");
        setCacheHit(false);
        return;
      }
      const data = await res.json();
      if (data.cached && data.brief) {
        setPhase("done");
        setCacheHit(true);
        setText(
          `[CACHE HIT] Loaded cached research brief for ${data.title}.\n` +
          `Last updated: ${new Date(data.updatedAt).toLocaleString()}\n` +
          `Click "Refresh" to re-run with AI.\n\n` +
          `(Cached — open the Glossary tab to view locked terms.)`
        );
        onBriefReady(data.brief);
        onBriefVersionChange?.(Date.now());
      }
    } catch (err) {
      console.error("Failed to load cached brief:", err);
    }
  }, [tmdbId, tmdbMediaType, onBriefReady, onBriefVersionChange]);

  useEffect(() => {
    loadFromCache();
  }, [loadFromCache]);

  const run = useCallback(
    async (forceRefresh: boolean = false) => {
      if (!context) return;
      if (!tmdbId || !tmdbMediaType) {
        toast({ title: "Pick a movie first", variant: "destructive" });
        return;
      }

      setPhase("running");
      setText("");
      setError(null);
      setCacheHit(false);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            context,
            tmdb_id: tmdbId,
            tmdb_media_type: tmdbMediaType,
            force_refresh: forceRefresh,
          }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          let errMsg = `Request failed: ${res.status}`;
          try {
            const errJson = await res.json();
            errMsg = errJson.error || errMsg;
          } catch {
            const errText = await res.text();
            if (errText) errMsg = errText;
          }
          throw new Error(errMsg);
        }

        // Check cache-hit header for display.
        const wasCacheHit = res.headers.get("x-cache-hit") === "true";
        setCacheHit(wasCacheHit);

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let full = "";
        let lastUpdate = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          full += chunk;
          // Throttle UI updates to ~30fps to avoid React re-render storms
          // when DeepSeek streams one character at a time.
          const now = Date.now();
          if (now - lastUpdate > 33) {
            setText(full);
            lastUpdate = now;
          }
        }
        // Final flush — make sure the last chunk is rendered.
        setText(full);

        if (full.includes("[ERROR]")) {
          throw new Error(
            full.split("[ERROR]")[1]?.trim() || "Research failed."
          );
        }

        // Fetch the structured brief that was just cached.
        const briefRes = await fetch(
          `/api/brief/get?tmdb_id=${tmdbId}&tmdb_media_type=${tmdbMediaType}`
        );
        if (briefRes.ok) {
          const briefData = await briefRes.json();
          if (briefData.brief) {
            onBriefReady(briefData.brief);
            onBriefVersionChange?.(Date.now());
          }
        }

        setPhase("done");
        toast({
          title: wasCacheHit ? "Loaded from cache" : "Research complete",
          description: wasCacheHit
            ? "No AI call needed."
            : "Translation context is ready.",
        });
      } catch (err: any) {
        if (err.name === "AbortError") {
          setPhase("idle");
          return;
        }
        setPhase("error");
        setError(err.message);
        toast({
          title: "Research failed",
          description: err.message,
          variant: "destructive",
        });
      }
    },
    [context, tmdbId, tmdbMediaType, onBriefReady, onBriefVersionChange, toast]
  );

  function stop() {
    abortRef.current?.abort();
    setPhase("idle");
  }

  const isBusy = phase === "running";

  return (
    <Card className="flex flex-col p-4 gap-3 h-full">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Research</h3>
          {isBusy && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Researching
            </Badge>
          )}
          {phase === "done" && cacheHit && (
            <Badge variant="outline" className="gap-1">
              <Database className="h-3 w-3" />
              Cached
            </Badge>
          )}
          {phase === "done" && !cacheHit && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Ready
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {phase === "done" && cacheHit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(true)}
              disabled={!context || isBusy}
              className="gap-1"
              title="Re-run research and overwrite the cached brief"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          )}
          {!isBusy ? (
            <Button
              size="sm"
              onClick={() => run(false)}
              disabled={!context || isBusy}
              className="gap-1"
            >
              <Sparkles className="h-3 w-3" />
              {phase === "done" ? "Re-run" : "Run Research"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={stop}>
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Progress indicator */}
      {isBusy && (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Streaming from AI...</span>
          </div>
          <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary animate-pulse" style={{ width: "60%" }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Single AI call with streaming. Takes 20-50 seconds for most movies.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0 rounded-md border bg-muted/30">
        <div className="p-3">
          {text ? (
            <pre className="whitespace-pre-wrap sinhala-serif text-sm leading-relaxed" lang="si">
              {text}
            </pre>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              {context
                ? "Click \"Run Research\" to analyse this movie."
                : "Pick a movie first to enable research."}
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
