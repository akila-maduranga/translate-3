"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type SafeUser } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Users,
  Film,
  TrendingUp,
  Crown,
  Shield,
  ArrowLeft,
  Loader2,
  Mail,
} from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "FREE" | "PREMIUM" | "ADMIN";
  createdAt: string;
  _count: { translations: number };
  translationsToday: number;
}

interface AdminStats {
  users: { total: number; free: number; premium: number; admin: number };
  translations: { today: number; last7Days: number };
  dailyBreakdown: { date: string; count: number }[];
  recentJobs: Array<{
    id: string;
    title: string;
    cueCount: number;
    translatedCount: number;
    source: string;
    format: string;
    durationMs: number;
    createdAt: string;
    userEmail: string;
    userName: string | null;
  }>;
}

interface AdminPanelProps {
  onBack: () => void;
}

export function AdminPanel({ onBack }: AdminPanelProps) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/stats", { cache: "no-store" }),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateRole(userId: string, role: "FREE" | "PREMIUM" | "ADMIN") {
    // Optimistic update.
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role } : u))
    );
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast({
        title: "Role updated",
        description: `${data.user.email} → ${role}`,
      });
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err.message,
        variant: "destructive",
      });
      load(); // rollback
    }
  }

  const filtered = users.filter(
    (u) =>
      !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Back to app
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <span className="font-semibold">Admin Panel</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
        {/* Stats cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Total users"
            value={stats?.users.total ?? "—"}
            loading={loading}
          />
          <StatCard
            icon={<Crown className="h-4 w-4" />}
            label="Premium"
            value={stats?.users.premium ?? "—"}
            loading={loading}
            accent="text-amber-600"
          />
          <StatCard
            icon={<Film className="h-4 w-4" />}
            label="Translations today"
            value={stats?.translations.today ?? "—"}
            loading={loading}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Last 7 days"
            value={stats?.translations.last7Days ?? "—"}
            loading={loading}
          />
        </section>

        {/* Daily breakdown chart */}
        {stats && (
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Daily translations (last 7 days)</h3>
            <div className="flex items-end gap-2 h-32">
              {stats.dailyBreakdown.map((d) => {
                const max = Math.max(
                  ...stats.dailyBreakdown.map((x) => x.count),
                  1
                );
                const heightPct = (d.count / max) * 100;
                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col items-center justify-end gap-1"
                  >
                    <div className="text-xs font-medium">{d.count}</div>
                    <div
                      className="w-full bg-primary/80 rounded-t"
                      style={{ height: `${heightPct}%`, minHeight: d.count > 0 ? "4px" : "0" }}
                    />
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(d.date).toLocaleDateString("en", {
                        weekday: "short",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* User table */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Users ({filtered.length})</h3>
            <Input
              placeholder="Search email or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <ScrollArea className="max-h-[28rem]">
            <div className="divide-y">
              {loading ? (
                <div className="p-8 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No users found.
                </div>
              ) : (
                filtered.map((u) => (
                  <div
                    key={u.id}
                    className="p-3 flex flex-wrap items-center gap-3 hover:bg-muted/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{u.email}</span>
                        <RoleBadge role={u.role} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {u.name && <span>{u.name} · </span>}
                        Joined{" "}
                        {new Date(u.createdAt).toLocaleDateString("en", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                        {" · "}
                        {u._count.translations} total ·{" "}
                        <span className="text-foreground font-medium">
                          {u.translationsToday} today
                        </span>
                      </div>
                    </div>
                    {u.id !== user?.id && (
                      <Select
                        value={u.role}
                        onValueChange={(v) =>
                          updateRole(
                            u.id,
                            v as "FREE" | "PREMIUM" | "ADMIN"
                          )
                        }
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FREE">Free</SelectItem>
                          <SelectItem value="PREMIUM">Premium</SelectItem>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Recent jobs */}
        {stats && stats.recentJobs.length > 0 && (
          <Card className="overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Recent translations</h3>
            </div>
            <ScrollArea className="max-h-96">
              <div className="divide-y">
                {stats.recentJobs.map((j) => (
                  <div key={j.id} className="p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{j.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(j.createdAt).toLocaleString("en", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <Mail className="h-3 w-3" />
                      <span>{j.userEmail}</span>
                      <span>·</span>
                      <span>
                        {j.translatedCount}/{j.cueCount} cues
                      </span>
                      <span>·</span>
                      <Badge variant="outline" className="text-[10px]">
                        {j.source}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {j.format}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  loading?: boolean;
  accent?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-2 text-2xl font-bold ${accent ?? ""} ${
          loading ? "opacity-50" : ""
        }`}
      >
        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : value}
      </div>
    </Card>
  );
}

function RoleBadge({ role }: { role: "FREE" | "PREMIUM" | "ADMIN" }) {
  if (role === "ADMIN") {
    return (
      <Badge variant="outline" className="gap-1 bg-red-50 dark:bg-red-950/30">
        <Shield className="h-3 w-3" /> Admin
      </Badge>
    );
  }
  if (role === "PREMIUM") {
    return (
      <Badge variant="outline" className="gap-1 bg-amber-50 dark:bg-amber-950/30">
        <Crown className="h-3 w-3" /> Premium
      </Badge>
    );
  }
  return <Badge variant="outline">Free</Badge>;
}
