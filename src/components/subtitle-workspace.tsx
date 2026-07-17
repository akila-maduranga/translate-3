"use client";

import { useState, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  Download,
  Pause,
  Loader2,
  CheckCircle2,
  Languages,
  RefreshCw,
  Pencil,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  parseSubtitles,
  serializeSubtitles,
  detectFormat,
  type SubtitleCue,
  type SubtitleFormat,
} from "@/lib/subtitle";
import type { TranslationContextBundle } from "@/lib/tmdb";
import type { ResearchBrief } from "@/lib/translate-context";

interface SubtitleWorkspaceProps {
  context: TranslationContextBundle | null;
  brief: ResearchBrief | null;
  tmdbId: number | null;
  tmdbMediaType: "movie" | "tv" | null;
  /** Called when a translation completes — used to refresh the usage counter. */
  onTranslationComplete?: (info: {
    title: string;
    cueCount: number;
    translatedCount: number;
    source: "tmdb" | "ai";
    format: "srt" | "vtt";
    durationMs: number;
  }) => void;
}

export function SubtitleWorkspace({
  context,
  brief,
  tmdbId,
  tmdbMediaType,
  onTranslationComplete,
}: SubtitleWorkspaceProps) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [format, setFormat] = useState<SubtitleFormat>("srt");
  const [fileName, setFileName] = useState<string>("");
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [retranslatingIdx, setRetranslatingIdx] = useState<number | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editInstruction, setEditInstruction] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const onFile = useCallback(
    async (file: File) => {
      const fmt = detectFormat(file.name);
      setFormat(fmt);
      setFileName(file.name);
      try {
        const text = await file.text();
        const parsed = parseSubtitles(text, fmt);
        if (parsed.length === 0) {
          toast({
            title: "No cues found",
            description:
              "Couldn't parse any subtitle cues from this file. Make sure it's a valid .srt or .vtt.",
            variant: "destructive",
          });
          return;
        }
        setCues(parsed);
        toast({
          title: `Loaded ${parsed.length} cues`,
          description: `${file.name} (${fmt.toUpperCase()})`,
        });
      } catch (err: any) {
        toast({
          title: "Failed to parse file",
          description: err.message,
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  async function translateAll() {
    if (!context) {
      toast({
        title: "Pick a movie first",
        description: "Translation needs a movie context.",
        variant: "destructive",
      });
      return;
    }
    if (!brief) {
      toast({
        title: "Run research first",
        description: "Click \"Run Research\" to build the translation brief.",
        variant: "destructive",
      });
      return;
    }
    if (cues.length === 0) return;

    setTranslating(true);
    setDone(0);
    setTotal(cues.length);
    setProgress(0);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const batchSize = 8;  // sensible default, no longer user-configurable
    const rolling = 4;
    const localCues = cues.map((c) => ({ ...c }));
    const startTime = Date.now();

    try {
      for (let i = 0; i < localCues.length; i += batchSize) {
        if (ac.signal.aborted) break;
        const batch = localCues.slice(i, i + batchSize);
        const previousCues = localCues.slice(Math.max(0, i - rolling), i);

        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cues: batch,
            previous_cues: previousCues,
            brief,
            tmdb_id: tmdbId ?? undefined,
            tmdb_media_type: tmdbMediaType ?? undefined,
          }),
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.error || "Translation failed";
          throw new Error(data.hint ? `${msg} — ${data.hint}` : msg);
        }

        const translations: string[] = data.translations ?? [];
        for (let j = 0; j < batch.length; j++) {
          batch[j].translated = translations[j] ?? "";
        }

        const newDone = Math.min(i + batchSize, localCues.length);
        setDone(newDone);
        setProgress(Math.round((newDone / localCues.length) * 100));
        // Push incremental update to UI
        setCues((prev) => {
          const next = [...prev];
          for (let j = 0; j < batch.length; j++) {
            next[i + j] = { ...batch[j] };
          }
          return next;
        });
      }

      if (!ac.signal.aborted) {
        const translatedCount = localCues.filter((c) => c.translated).length;
        toast({
          title: "Translation complete",
          description: `${translatedCount} of ${localCues.length} cues translated to Sinhala.`,
        });
        // Record the job — this increments the daily usage counter.
        try {
          await fetch("/api/jobs/record", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: context?.title ?? "Unknown",
              cueCount: localCues.length,
              translatedCount,
              source: tmdbId && tmdbId < 0 ? "ai" : "tmdb",
              format,
              durationMs: Date.now() - startTime,
            }),
          });
          onTranslationComplete?.({
            title: context?.title ?? "Unknown",
            cueCount: localCues.length,
            translatedCount,
            source: tmdbId && tmdbId < 0 ? "ai" : "tmdb",
            format,
            durationMs: Date.now() - startTime,
          });
        } catch (err) {
          console.error("Failed to record job:", err);
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({
          title: "Translation failed",
          description: err.message,
          variant: "destructive",
        });
      }
    } finally {
      setTranslating(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setTranslating(false);
  }

  /**
   * Re-translate a single cue. Optional `instruction` is appended to the
   * brief's cultural notes so the model sees it as a directive for this
   * cue only (e.g. "make it shorter", "use formal register", "this is
   * a sword name not a person").
   */
  async function retranslateCue(idx: number, instruction?: string) {
    if (!context || !brief) {
      toast({
        title: "Need movie + brief first",
        description: "Pick a movie and run research before re-translating.",
        variant: "destructive",
      });
      return;
    }
    const cue = cues[idx];
    const rolling = 4;
    const previousCues = cues
      .slice(Math.max(0, idx - rolling), idx)
      .map((c) => ({ ...c }));

    setRetranslatingIdx(idx);
    try {
      const res = await fetch("/api/translate-cue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cue,
          previous_cues: previousCues,
          brief,
          tmdb_id: tmdbId ?? undefined,
          tmdb_media_type: tmdbMediaType ?? undefined,
          instruction: instruction?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "Re-translate failed";
        throw new Error(data.hint ? `${msg} — ${data.hint}` : msg);
      }

      setCues((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], translated: data.translation ?? "" };
        return next;
      });
      toast({
        title: "Cue re-translated",
        description: instruction
          ? `Applied: "${instruction}"`
          : "Fresh translation applied.",
      });
    } catch (err: any) {
      toast({
        title: "Re-translate failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRetranslatingIdx(null);
      setEditIdx(null);
      setEditValue("");
      setEditInstruction("");
    }
  }

  function startEdit(idx: number) {
    setEditIdx(idx);
    setEditValue(cues[idx].translated ?? "");
    setEditInstruction("");
    setActiveIdx(idx);
  }

  function saveManualEdit(idx: number) {
    setCues((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], translated: editValue };
      return next;
    });
    setEditIdx(null);
    setEditValue("");
    setEditInstruction("");
    toast({ title: "Manual edit saved" });
  }

  function download() {
    const out = serializeSubtitles(cues, format);
    const blob = new Blob([out], {
      type: format === "srt" ? "application/x-subrip" : "text/vtt",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName
      ? fileName.replace(/\.(srt|vtt)$/i, "") + `.si.${format}`
      : `subtitles.si.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadEnglish() {
    const out = serializeSubtitles(
      cues.map((c) => ({ ...c, translated: c.text })),
      format
    );
    const blob = new Blob([out], {
      type: format === "srt" ? "application/x-subrip" : "text/vtt",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName
      ? fileName.replace(/\.(srt|vtt)$/i, "") + `.en.${format}`
      : `subtitles.en.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const translatedCount = cues.filter((c) => c.translated).length;
  const canTranslate = !!context && !!brief && cues.length > 0 && !translating;
  const canRetranslate = !!context && !!brief && !translating;

  return (
    <Card className="flex flex-col p-4 gap-3 h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Subtitle Workspace</h3>
          {cues.length > 0 && (
            <Badge variant="outline" className="gap-1">
              {cues.length} cues
            </Badge>
          )}
          {translatedCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {translatedCount} translated
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as SubtitleFormat)}
            disabled={translating}
          >
            <SelectTrigger className="w-24 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="srt">.srt</SelectItem>
              <SelectItem value="vtt">.vtt</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={downloadEnglish}
            disabled={cues.length === 0}
            className="gap-1"
          >
            <Download className="h-3 w-3" /> EN
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={download}
            disabled={translatedCount === 0}
            className="gap-1"
          >
            <Download className="h-3 w-3" /> සිං (SI)
          </Button>

          {!translating ? (
            <Button
              size="sm"
              onClick={translateAll}
              disabled={!canTranslate}
              className="gap-1"
            >
              <Languages className="h-3 w-3" />
              Translate All
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stop} className="gap-1">
              <Pause className="h-3 w-3" /> Stop
            </Button>
          )}
        </div>
      </div>

      {cues.length === 0 ? (
        <div
          className="flex-1 min-h-[12rem] flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">
            Drop your .srt or .vtt file here
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            or click to browse — files are parsed locally in your browser
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <>
          {(translating || done > 0) && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {translating && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Translating... {done} / {total}
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0 rounded-md border">
            <div className="divide-y">
              {cues.map((cue, idx) => {
                const isActive = activeIdx === idx;
                const isEditing = editIdx === idx;
                const isRetranslating = retranslatingIdx === idx;
                return (
                  <div
                    key={idx}
                    className={`p-2 transition-colors ${
                      isActive ? "bg-muted/80" : "hover:bg-muted/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveIdx(isActive ? null : idx)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        {isActive ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        <span className="font-mono">{cue.startRaw}</span>
                        <span>→</span>
                        <span className="font-mono">{cue.endRaw}</span>
                        {cue.translated && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 ml-auto" />
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="text-sm cue-text">{cue.text}</div>
                        <div className="text-sm font-medium cue-sinhala">
                          {cue.translated ? (
                            <span
                              className="text-foreground cue-text"
                              lang="si"
                              dir="ltr"
                            >
                              {cue.translated}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              (not translated yet)
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Expanded controls for active cue */}
                    {isActive && (
                      <div className="mt-2 pt-2 border-t space-y-2">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="සිංහල පරිවර්තනය"
                              className="sinhala"
                              lang="si"
                              dir="ltr"
                              autoFocus
                            />
                            <Input
                              value={editInstruction}
                              onChange={(e) =>
                                setEditInstruction(e.target.value)
                              }
                              placeholder="Optional instruction for re-translate (e.g. 'make it shorter')"
                            />
                            <div className="flex flex-wrap gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditIdx(null);
                                  setEditValue("");
                                  setEditInstruction("");
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => saveManualEdit(idx)}
                              >
                                Save Manual Edit
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  retranslateCue(idx, editInstruction)
                                }
                                disabled={isRetranslating || !canRetranslate}
                                className="gap-1"
                              >
                                {isRetranslating ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                Re-translate
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(idx)}
                              className="gap-1"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit / Re-translate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retranslateCue(idx)}
                              disabled={isRetranslating || !canRetranslate}
                              className="gap-1"
                            >
                              {isRetranslating ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              Quick Re-translate
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}
    </Card>
  );
}
