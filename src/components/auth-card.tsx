"use client";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Languages, ArrowLeft } from "lucide-react";

interface AuthCardProps {
  mode: "login" | "signup";
  onModeChange: (mode: "login" | "signup") => void;
  onBack: () => void;
}

export function AuthCard({ mode, onModeChange, onBack }: AuthCardProps) {
  const { login, signup } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
        toast({ title: "Welcome back!" });
      } else {
        await signup(email, password, name);
        toast({ title: "Account created!", description: "Welcome to SubSinhala." });
      }
      // Auth provider will re-render and route to app.
    } catch (err: any) {
      toast({
        title: mode === "login" ? "Login failed" : "Signup failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-muted/40 to-background px-4 py-10">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="absolute top-4 left-4 gap-1"
      >
        <ArrowLeft className="h-4 w-4" /> Home
      </Button>

      <div className="flex items-center gap-2 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Languages className="h-5 w-5" />
        </div>
        <div>
          <div className="font-bold text-lg leading-tight">SubSinhala</div>
          <div className="text-[10px] text-muted-foreground leading-tight">
            Context-aware EN → සිංහල subtitles
          </div>
        </div>
      </div>

      <Card className="w-full max-w-md p-6 space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "login"
              ? "Log in to translate subtitles."
              : "Free to start — 1 subtitle per day."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full gap-1">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "login" ? "Log in" : "Sign up"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => onModeChange("signup")}
                className="text-foreground font-medium underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => onModeChange("login")}
                className="text-foreground font-medium underline"
              >
                Log in
              </button>
            </>
          )}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground mt-4 text-center max-w-md">
        Free accounts get 1 subtitle translation per day. Premium users get
        unlimited translations — contact the admin to upgrade.
      </p>
    </div>
  );
}
