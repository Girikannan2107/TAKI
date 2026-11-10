"use client";

import { useEffect, useRef } from "react";
import { STORE_KEY, useTakiStore } from "./index";

/**
 * Loads persisted demo state after mount (avoids SSR hydration mismatches),
 * refreshes stale demo data, and keeps tabs in sync. Mount once in providers.
 */
export function StoreHydrator({ onDemoRefreshed }: { onDemoRefreshed?: () => void }) {
  const cb = useRef(onDemoRefreshed);
  useEffect(() => {
    cb.current = onDemoRefreshed;
  }, [onDemoRefreshed]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(useTakiStore.persist.rehydrate())
      .catch(() => {
        console.warn("[TAKI demo] Could not read stored demo data; starting fresh.");
      })
      .finally(() => {
        if (cancelled) return;
        const state = useTakiStore.getState();
        const hadStoredData = (() => {
          try {
            return localStorage.getItem(STORE_KEY) !== null;
          } catch {
            return false;
          }
        })();
        const refreshed = state.refreshDemoIfStale();
        state.setHydrated(true);
        if (refreshed && hadStoredData) cb.current?.();
      });

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY) void useTakiStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
