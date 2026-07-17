"use client";

/**
 * useAuth — client-side hook for the current user's auth state.
 *
 * Uses a module-level singleton so all components share the same
 * auth state (otherwise login in one component wouldn't update
 * other components using the hook).
 */

import { useState, useEffect, useCallback } from "react";

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  role: "FREE" | "PREMIUM" | "ADMIN";
  createdAt: string; // ISO
}

export interface UsageStatus {
  role: "FREE" | "PREMIUM" | "ADMIN";
  limit: number;
  usedToday: number;
  remaining: number;
  unlimited: boolean;
}

// Module-level singleton — shared across all useAuth() callers.
let currentUser: SafeUser | null = null;
let loadingPromise: Promise<void> | null = null;
const subscribers = new Set<(u: SafeUser | null) => void>();

function setUser(u: SafeUser | null) {
  currentUser = u;
  for (const sub of subscribers) sub(u);
}

async function fetchUser() {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();
    setUser(data.user ?? null);
  } catch {
    setUser(null);
  }
}

export function useAuth() {
  const [user, setUserState] = useState<SafeUser | null>(currentUser);
  const [loading, setLoading] = useState(!currentUser && !loadingPromise);

  useEffect(() => {
    // Subscribe to module-level changes. The subscriber callback
    // updates local state when the shared user changes — this is the
    // "subscribe to external system" pattern, not a cascading render.
    const sub = (u: SafeUser | null) => {
      setUserState(u);
      setLoading(false);
    };
    subscribers.add(sub);

    // If we haven't fetched yet, do it now.
    if (!currentUser && !loadingPromise) {
      loadingPromise = fetchUser().finally(() => {
        loadingPromise = null;
      });
    }

    return () => {
      subscribers.delete(sub);
    };
  }, []);

  const refresh = useCallback(async () => {
    await fetchUser();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setUser(data.user);
      return data.user as SafeUser;
    },
    []
  );

  const signup = useCallback(
    async (email: string, password: string, name?: string) => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setUser(data.user);
      return data.user as SafeUser;
    },
    []
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return { user, loading, refresh, login, signup, logout };
}
