"use client";

/**
 * useUsage — fetches the current user's daily quota + usage.
 * Re-fetches when the user changes or when `bump` is called (e.g.
 * after a translation completes).
 */

import { useState, useEffect, useCallback } from "react";
import type { UsageStatus } from "./use-auth";

export function useUsage(userId: string | null | undefined) {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, refresh };
}
