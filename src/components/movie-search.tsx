"use client";

import { useState, useCallback, useRef } from "react";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Star, Film, Tv, Sparkles } from "lucide-react";
import {
  posterUrl,
  type TmdbSearchResult,
  type TranslationContextBundle,
} from "@/lib/tmdb";

interface MovieSearchProps {
  onPick: (
    result: TmdbSearchResult | AiSearchResult,
    ctx: TranslationContextBundle,
    source: "tmdb" | "ai"
  ) => void;
  selected?: { id: number; media_type: string } | null;
}

export interface AiSearchResult {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string;
  release_date?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  confidence?: "high" | "medium" | "low";
}

export function MovieSearch({ onPick, selected }: MovieSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ result: TmdbSearchResult | AiSearchResult; source: "tmdb" | "ai" }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setResults([]);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // --- Step 1: try TMDB ---
    try {
      const res = await fetch(
        `/api/tmdb/search?query=${encodeURIComponent(q)}`,
        { signal: ac.signal }
      );
      const data = await res.json();
      if (res.ok && (data.results ?? []).length > 0) {
        setResults(
          (data.results as TmdbSearchResult[]).map((r) => ({
            result: r,
            source: "tmdb" as const,
          }))
        );
        setLoading(false);
        return;
      }
      // TMDB returned no results or error — fall through to AI.
    } catch (err: any) {
      if (err.name === "AbortError") {
        setLoading(false);
        return;
      }
    }

    // --- Step 2: fall back to AI search ---
    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI search failed");
      const aiResults: AiSearchResult[] = (data.results ?? []).map(
        (r: TranslationContextBundle & { confidence?: string }) => ({
          id: 0,
          media_type: r.media_type,
          title: r.title,
          original_title: r.original_title,
          release_date: r.release_year ? `${r.release_year}-01-01` : undefined,
          overview: r.overview,
          poster_path: null,
          backdrop_path: null,
          vote_average: 0,
          confidence: r.confidence as "high" | "medium" | "low" | undefined,
        })
      );
      setResults(
        aiResults.map((r) => ({ result: r, source: "ai" as const }))
      );
      if (aiResults.length === 0) {
        toast({
          title: "Couldn't find that movie",
          description:
            "Try adding more detail — a quote, an actor, the release year.",
        });
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({
          title: "Search failed",
          description: err.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [query, toast]);

  async function pickResult(
    r: TmdbSearchResult | AiSearchResult,
    src: "tmdb" | "ai"
  ) {
    setLoadingId(r.id || Date.now());

    if (src === "ai") {
      try {
        const res = await fetch("/api/ai-search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `${r.title} ${r.release_date ?? ""} ${r.overview.slice(0, 200)}`,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lookup failed");
        const ctx: TranslationContextBundle | undefined = data.results?.[0];
        if (!ctx) throw new Error("Couldn't load movie details.");
        onPick(r, ctx, "ai");
      } catch (err: any) {
        toast({
          title: "Failed to load",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setLoadingId(null);
      }
      return;
    }

    // TMDB details
    try {
      const res = await fetch(
        `/api/tmdb/details?id=${r.id}&type=${r.media_type}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Details failed");
      onPick(r, data.context_bundle, "tmdb");
    } catch (err: any) {
      toast({
        title: "Failed to load",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Search for a movie or TV show..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
        />
        <Button onClick={runSearch} disabled={loading} className="gap-2">
          <Search className="h-4 w-4" />
          Search
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-md" />
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[28rem] overflow-y-auto pr-1">
          {results.map(({ result: r, source: src }, idx) => {
            const aiConfidence =
              src === "ai" ? (r as AiSearchResult).confidence : undefined;
            return (
              <Card
                key={`${src}-${r.id || "ai"}-${idx}`}
                role="button"
                tabIndex={0}
                onClick={() => pickResult(r, src)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pickResult(r, src);
                  }
                }}
                className="group cursor-pointer overflow-hidden p-0 transition-all hover:ring-2 hover:ring-primary"
              >
                <div className="relative aspect-[2/3] bg-muted">
                  {r.poster_path ? (
                    <Image
                      src={posterUrl(r.poster_path, "w342")}
                      alt={r.title}
                      fill
                      sizes="(max-width: 640px) 50vw, 33vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground">
                      {src === "ai" ? (
                        <Sparkles className="h-8 w-8" />
                      ) : (
                        <Film className="h-8 w-8" />
                      )}
                      <div className="text-xs line-clamp-3">
                        {r.overview.slice(0, 120)}
                      </div>
                    </div>
                  )}
                  {loadingId === (r.id || Date.now()) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-xs">
                      Loading...
                    </div>
                  )}
                  <div className="absolute left-2 top-2 flex gap-1">
                    <Badge variant="secondary" className="gap-1">
                      {r.media_type === "tv" ? (
                        <Tv className="h-3 w-3" />
                      ) : (
                        <Film className="h-3 w-3" />
                      )}
                      {r.media_type === "tv" ? "TV" : "Movie"}
                    </Badge>
                    {src === "ai" && (
                      <Badge
                        variant="outline"
                        className="gap-1 bg-purple-50 dark:bg-purple-950/50"
                      >
                        <Sparkles className="h-3 w-3" />
                        AI
                      </Badge>
                    )}
                    {aiConfidence && (
                      <Badge
                        variant="outline"
                        className={
                          aiConfidence === "high"
                            ? "bg-emerald-50 dark:bg-emerald-950/50"
                            : aiConfidence === "medium"
                            ? "bg-amber-50 dark:bg-amber-950/50"
                            : "bg-red-50 dark:bg-red-950/50"
                        }
                      >
                        {aiConfidence}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="p-2 space-y-1">
                  <div className="line-clamp-2 text-sm font-medium leading-tight">
                    {r.title}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.release_date && (
                      <span>{r.release_date.slice(0, 4)}</span>
                    )}
                    {r.vote_average > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-current" />
                        {r.vote_average.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
