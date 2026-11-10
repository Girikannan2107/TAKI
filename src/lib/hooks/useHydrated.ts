"use client";

import { useTakiStore } from "@/lib/store";

/**
 * True once persisted demo state has loaded on the client. Server render and the
 * first client render return false — render a Skeleton until this is true.
 */
export function useHydrated(): boolean {
  return useTakiStore((s) => s.hydrated);
}
