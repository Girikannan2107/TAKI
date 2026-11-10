"use client";
/**
 * TAKI demo store (zustand + localStorage, key "taki-demo-v1").
 * DEMO PERSISTENCE ONLY — in production this is replaced by Firebase services.
 *
 * Reading: use the hooks in ./selectors.ts (or `useTakiStore(s => s.db.x)` for raw data).
 * Writing business data: use the async services in `@/lib/services/*` (they call `mutate`).
 * UI flow state (search, routeDraft, pendingAuth) has direct setters below.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { buildSeed } from "@/lib/data/seed";
import { SEED_VERSION } from "@/lib/domain/constants";
import { todayIst } from "@/lib/domain/dates";
import type { CommandContext, Db } from "@/lib/domain/db";
import type { Id, Mobile, OtpChallenge, Role, RouteDraft, Session, Shipment } from "@/lib/domain/types";
import { getNow } from "@/lib/utils/clock";

export const STORE_KEY = "taki-demo-v1";
export const STORE_VERSION = 1;

export type AuthFlow = "signup" | "login" | "reset";

export interface PendingAuth {
  flow: AuthFlow;
  role?: Role;
  mobile: Mobile;
  challengeId: string;
  verified: boolean;
  /** Validated return path carried through the flow. */
  next?: string;
}

export interface TakiState {
  db: Db;
  session: Session | null;
  /** Last customer search (Customer Dashboard → Available Vehicles → Booking). */
  search: Shipment | null;
  /** Add New Route → Set Pricing draft. */
  routeDraft: RouteDraft;
  pendingAuth: PendingAuth | null;
  /** Current demo OTP challenge (code is shown on screen in demo mode). */
  otp: OtpChallenge | null;
  /** True once persisted state is loaded and demo data is fresh (client only). */
  hydrated: boolean;

  /** Clone db, run a command, commit atomically. Throws (and commits nothing) on error. */
  mutate<T>(fn: (db: Db, ctx: CommandContext) => T): T;
  setSession(session: Session | null): void;
  logout(): void;
  setSearch(search: Shipment | null): void;
  updateRouteDraft(patch: Partial<RouteDraft>): void;
  clearRouteDraft(): void;
  setPendingAuth(p: PendingAuth | null): void;
  setOtp(otp: OtpChallenge | null): void;
  markNotificationsRead(role: Role, recipientId: Id): void;
  /** Wipe all demo data (accounts too) and reseed. */
  resetDemo(): void;
  /** Reseed marketplace data if it was seeded on another day. Returns true if refreshed. */
  refreshDemoIfStale(): boolean;
  setHydrated(v: boolean): void;
}

export const EMPTY_ROUTE_DRAFT: RouteDraft = { stopCityIds: [] };

function context(): CommandContext {
  return { now: getNow(), rand: Math.random };
}

/** Keep user-created accounts/profiles/vehicles when marketplace data is reseeded. */
function reseedKeepingAccounts(old: Db): Db {
  const fresh = buildSeed(getNow());
  const keep = <T>(fromOld: Record<string, T>, into: Record<string, T>) => {
    for (const [id, v] of Object.entries(fromOld)) if (!(id in into)) into[id] = v;
  };
  keep(old.accounts, fresh.accounts);
  keep(old.customers, fresh.customers);
  keep(old.drivers, fresh.drivers);
  keep(old.vehicles, fresh.vehicles);
  // Preserve password changes / profile edits on seeded demo accounts too.
  for (const id of Object.keys(fresh.accounts)) if (old.accounts[id]) fresh.accounts[id] = old.accounts[id]!;
  return fresh;
}

function looksLikeDb(v: unknown): v is Db {
  if (!v || typeof v !== "object") return false;
  const d = v as Partial<Db>;
  return (
    !!d.accounts && !!d.customers && !!d.drivers && !!d.vehicles && !!d.routes && !!d.bookings && !!d.payments &&
    !!d.earnings && Array.isArray(d.archivedMonths) && !!d.payouts && !!d.notifications && !!d.demoMeta
  );
}

export const useTakiStore = create<TakiState>()(
  persist(
    (set, get) => ({
      db: buildSeed(getNow()),
      session: null,
      search: null,
      routeDraft: EMPTY_ROUTE_DRAFT,
      pendingAuth: null,
      otp: null,
      hydrated: false,

      mutate(fn) {
        const draft = structuredClone(get().db);
        const result = fn(draft, context());
        set({ db: draft });
        return result;
      },
      setSession: (session) => set({ session }),
      logout: () => set({ session: null, pendingAuth: null, otp: null, search: null, routeDraft: EMPTY_ROUTE_DRAFT }),
      setSearch: (search) => set({ search }),
      updateRouteDraft: (patch) => set({ routeDraft: { ...get().routeDraft, ...patch } }),
      clearRouteDraft: () => set({ routeDraft: EMPTY_ROUTE_DRAFT }),
      setPendingAuth: (pendingAuth) => set({ pendingAuth }),
      setOtp: (otp) => set({ otp }),
      markNotificationsRead(role, recipientId) {
        const now = getNow().toISOString();
        const db = get().db;
        const notifications = { ...db.notifications };
        let changed = false;
        for (const n of Object.values(notifications)) {
          if (n.recipientRole === role && n.recipientId === recipientId && !n.readAt) {
            notifications[n.id] = { ...n, readAt: now };
            changed = true;
          }
        }
        if (changed) set({ db: { ...db, notifications } });
      },
      resetDemo: () =>
        set({ db: buildSeed(getNow()), session: null, search: null, routeDraft: EMPTY_ROUTE_DRAFT, pendingAuth: null, otp: null }),
      refreshDemoIfStale() {
        const { db } = get();
        const today = todayIst(getNow());
        if (db.demoMeta.seedVersion === SEED_VERSION && db.demoMeta.seededOn === today) return false;
        const fresh = reseedKeepingAccounts(db);
        const session = get().session;
        set({ db: fresh, search: null, session: session && fresh.accounts[session.accountId] ? session : null });
        return true;
      },
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: STORE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        db: s.db,
        session: s.session,
        search: s.search,
        routeDraft: s.routeDraft,
        pendingAuth: s.pendingAuth,
        otp: s.otp,
      }),
      // Unknown/older versions: demo data is disposable — start fresh.
      migrate: () => ({}) as Partial<TakiState>,
      merge(persisted, current) {
        const p = (persisted ?? {}) as Partial<TakiState>;
        if (p.db !== undefined && !looksLikeDb(p.db)) {
          console.warn("[TAKI demo] Stored demo data was corrupt and has been reset.");
          return current;
        }
        return {
          ...current,
          ...p,
          db: p.db ?? current.db,
          routeDraft: { ...EMPTY_ROUTE_DRAFT, ...(p.routeDraft ?? {}) },
        };
      },
    },
  ),
);
