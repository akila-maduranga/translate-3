"use client";

import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Calendar, Globe, X, Sparkles } from "lucide-react";
import type { TranslationContextBundle } from "@/lib/tmdb";

interface MovieContextCardProps {
  ctx: TranslationContextBundle;
  onClear: () => void;
  source?: "tmdb" | "ai";
}

export function MovieContextCard({ ctx, onClear, source = "tmdb" }: MovieContextCardProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative h-40 w-full bg-muted">
        {ctx.backdrop_url ? (
          <Image
            src={ctx.backdrop_url}
            alt={ctx.title}
            fill
            className="object-cover"
            unoptimized
            priority
          />
        ) : (
          // AI-sourced or poster-less movies get a tasteful gradient
          // instead of an empty box.
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-muted to-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <Button
          variant="secondary"
          size="sm"
          className="absolute right-2 top-2 gap-1"
          onClick={onClear}
        >
          <X className="h-3 w-3" /> Clear
        </Button>
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <div className="flex items-center gap-2 text-xs opacity-90">
            <Badge variant="secondary" className="capitalize">
              {ctx.media_type}
            </Badge>
            {source === "ai" && (
              <Badge
                variant="outline"
                className="gap-1 bg-purple-500/20 text-white border-purple-300/50"
              >
                <Sparkles className="h-3 w-3" />
                AI-identified
              </Badge>
            )}
            {ctx.release_year && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {ctx.release_year}
              </span>
            )}
            {ctx.runtime_minutes && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {Math.floor(ctx.runtime_minutes / 60)}h{" "}
                {ctx.runtime_minutes % 60}m
              </span>
            )}
            {ctx.production_countries[0] && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {ctx.production_countries[0]}
              </span>
            )}
          </div>
          <h2 className="mt-1 text-xl font-semibold drop-shadow-sm">
            {ctx.title}
          </h2>
          {ctx.tagline && (
            <p className="text-sm italic opacity-90">{ctx.tagline}</p>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {ctx.genres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ctx.genres.map((g) => (
              <Badge key={g} variant="outline" className="text-xs">
                {g}
              </Badge>
            ))}
          </div>
        )}

        {ctx.overview && (
          <p className="text-sm text-muted-foreground line-clamp-4">
            {ctx.overview}
          </p>
        )}

        {ctx.cast.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Cast
            </div>
            <div className="space-y-0.5">
              {ctx.cast.slice(0, 6).map((c) => (
                <div key={c.actor} className="text-sm">
                  <span className="font-medium">{c.actor}</span>{" "}
                  <span className="text-muted-foreground">as {c.character}</span>
                </div>
              ))}
              {ctx.cast.length > 6 && (
                <div className="text-xs text-muted-foreground">
                  +{ctx.cast.length - 6} more
                </div>
              )}
            </div>
          </div>
        )}

        {ctx.directors.length > 0 && (
          <div className="text-sm">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Director
            </span>{" "}
            {ctx.directors.join(", ")}
          </div>
        )}

        {ctx.keywords.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Keywords
            </div>
            <div className="flex flex-wrap gap-1">
              {ctx.keywords.slice(0, 12).map((k) => (
                <span
                  key={k}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
