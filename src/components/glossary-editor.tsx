"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Loader2,
  Database,
} from "lucide-react";
import type { TranslationContextBundle } from "@/lib/tmdb";
import type { GlossaryEntry, ResearchBrief } from "@/lib/translate-context";

interface GlossaryEditorProps {
  context: TranslationContextBundle | null;
  brief: ResearchBrief | null;
  tmdbId: number | null;
  tmdbMediaType: "movie" | "tv" | null;
  /** Bumped by parent whenever the research panel finishes a run, so we re-fetch overrides. */
  briefVersion: number;
}

interface EditState {
  english: string;
  sinhala: string;
  note: string;
}

export function GlossaryEditor({
  context,
  brief,
  tmdbId,
  tmdbMediaType,
  briefVersion,
}: GlossaryEditorProps) {
  // userOverrides = entries the user has manually added/edited.
  // lockedGlossary = the brief's locked glossary (read-only display).
  const [userOverrides, setUserOverrides] = useState<GlossaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null); // null = new
  const { toast } = useToast();

  // Load overrides whenever the selected movie changes or the brief is refreshed.
  const loadOverrides = useCallback(async () => {
    if (!tmdbId || !tmdbMediaType) {
      setUserOverrides([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/brief/overrides?tmdb_id=${tmdbId}&tmdb_media_type=${tmdbMediaType}`
      );
      const data = await res.json();
      if (res.ok) {
        setUserOverrides(data.overrides ?? []);
      }
    } catch (err: any) {
      // Silent — the user can still add overrides; we'll create the row on save.
      console.error("Failed to load overrides:", err);
    } finally {
      setLoading(false);
    }
  }, [tmdbId, tmdbMediaType]);

  useEffect(() => {
    loadOverrides();
  }, [loadOverrides, briefVersion]);

  function startAdd() {
    setEditing({ english: "", sinhala: "", note: "" });
    setEditIndex(null);
  }

  function startEdit(idx: number) {
    const e = userOverrides[idx];
    setEditing({ english: e.english, sinhala: e.sinhala, note: e.note ?? "" });
    setEditIndex(idx);
  }

  function cancelEdit() {
    setEditing(null);
    setEditIndex(null);
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.english.trim() || !editing.sinhala.trim()) {
      toast({
        title: "Both English and Sinhala are required",
        variant: "destructive",
      });
      return;
    }
    const entry: GlossaryEntry = {
      english: editing.english.trim(),
      sinhala: editing.sinhala.trim(),
      note: editing.note.trim() || undefined,
    };
    let next: GlossaryEntry[];
    if (editIndex === null) {
      next = [...userOverrides, entry];
    } else {
      next = [...userOverrides];
      next[editIndex] = entry;
    }
    setUserOverrides(next);
    setEditing(null);
    setEditIndex(null);
    // Persist immediately for snappy UX.
    await persist(next);
  }

  async function remove(idx: number) {
    const next = userOverrides.filter((_, i) => i !== idx);
    setUserOverrides(next);
    await persist(next);
  }

  async function persist(overrides: GlossaryEntry[]) {
    if (!tmdbId || !tmdbMediaType) {
      toast({
        title: "Pick a movie first",
        description: "Glossary overrides are saved per movie.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/brief/overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tmdb_id: tmdbId,
          tmdb_media_type: tmdbMediaType,
          overrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast({
        title: "Glossary saved",
        description: `${overrides.length} override(s) will be applied on next translation.`,
      });
    } catch (err: any) {
      // If save fails (e.g. brief not yet cached), show a softer message.
      toast({
        title: "Save failed",
        description:
          "Run research first so the brief exists, then add overrides.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const lockedGlossary = brief?.glossary ?? [];
  const lockedCharacters = brief?.characters ?? [];

  // Check which locked terms are overridden (for visual indicator).
  const overrideKeys = new Set(
    userOverrides.map((o) => o.english.toLowerCase().trim())
  );

  return (
    <Card className="flex flex-col p-4 gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Glossary Editor</h3>
          {loading && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading
            </Badge>
          )}
          {saving && (
            <Badge variant="secondary" className="gap-1">
              <Database className="h-3 w-3 animate-pulse" />
              Saving
            </Badge>
          )}
          {userOverrides.length > 0 && (
            <Badge variant="outline" className="gap-1">
              {userOverrides.length} override{userOverrides.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={startAdd}
          disabled={!context || !!editing}
          className="gap-1"
        >
          <Plus className="h-3 w-3" />
          Add Override
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        Locked terms come from DeepSeek research. Add your own overrides to
        force a specific Sinhala wording — overrides always win during
        translation. Saved per-movie in the server cache.
      </div>

      {/* Edit form */}
      {editing && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">English</Label>
              <Input
                value={editing.english}
                onChange={(e) =>
                  setEditing({ ...editing, english: e.target.value })
                }
                placeholder="e.g. Skyler"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sinhala (locked translation)</Label>
              <Input
                value={editing.sinhala}
                onChange={(e) =>
                  setEditing({ ...editing, sinhala: e.target.value })
                }
                placeholder="උදා: ස්කයිලර්"
                className="sinhala"
                lang="si"
                dir="ltr"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={editing.note}
              onChange={(e) =>
                setEditing({ ...editing, note: e.target.value })
              }
              placeholder="e.g. Keep as English per director's note"
              rows={2}
              dir="auto"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1">
              <X className="h-3 w-3" /> Cancel
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={saving} className="gap-1">
              <Save className="h-3 w-3" /> Save Override
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0 rounded-md border">
        <div className="p-3 space-y-4">
          {/* User overrides section */}
          <section>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Your overrides
            </div>
            {userOverrides.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">
                No overrides yet. Click &quot;Add Override&quot; to lock a
                specific Sinhala wording.
              </div>
            ) : (
              <div className="space-y-1.5">
                {userOverrides.map((o, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-md border bg-emerald-50 dark:bg-emerald-950/30 p-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <span className="font-medium">{o.english}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-medium sinhala" lang="si" dir="ltr">
                          {o.sinhala}
                        </span>
                      </div>
                      {o.note && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {o.note}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => startEdit(idx)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => remove(idx)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Locked brief glossary (read-only) */}
          {lockedGlossary.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Locked glossary (from research)
              </div>
              <div className="space-y-1">
                {lockedGlossary.slice(0, 60).map((g, idx) => {
                  const isOverridden = overrideKeys.has(
                    g.english.toLowerCase().trim()
                  );
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                        isOverridden
                          ? "opacity-50 line-through"
                          : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{g.english}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="sinhala" lang="si" dir="ltr">{g.sinhala}</span>
                        {g.note && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {"// "}{g.note}
                          </span>
                        )}
                      </div>
                      {!isOverridden && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setEditing({
                              english: g.english,
                              sinhala: g.sinhala,
                              note: g.note ?? "",
                            });
                            setEditIndex(null);
                          }}
                        >
                          Override
                        </Button>
                      )}
                    </div>
                  );
                })}
                {lockedGlossary.length > 60 && (
                  <div className="text-xs text-muted-foreground italic">
                    + {lockedGlossary.length - 60} more (locked, not shown)
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Characters (locked names) */}
          {lockedCharacters.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Characters (locked names)
              </div>
              <div className="space-y-1">
                {lockedCharacters.slice(0, 20).map((c, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{c.name}</span>
                      {c.description && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          — {c.description}
                        </span>
                      )}
                    </div>
                    <Badge variant="outline" className="sinhala" lang="si" dir="ltr">
                      {c.sinhala_name}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!context && (
            <div className="text-sm text-muted-foreground italic">
              Pick a movie to start editing its glossary.
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
