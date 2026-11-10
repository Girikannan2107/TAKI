/** In-memory marketplace database shape (persisted in demo mode; Firestore collections later). */
import type {
  ArchivedEarningsMonth,
  Booking,
  BookingId,
  Customer,
  DemoMeta,
  Driver,
  EarningEntry,
  Id,
  Notification,
  Payment,
  Payout,
  Route,
  UserAccount,
  Vehicle,
} from "./types";

export interface Db {
  accounts: Record<Id, UserAccount>;
  customers: Record<Id, Customer>;
  drivers: Record<Id, Driver>;
  vehicles: Record<Id, Vehicle>;
  routes: Record<Id, Route>;
  bookings: Record<BookingId, Booking>;
  payments: Record<Id, Payment>;
  earnings: Record<Id, EarningEntry>;
  archivedMonths: ArchivedEarningsMonth[];
  payouts: Record<Id, Payout>;
  notifications: Record<Id, Notification>;
  demoMeta: DemoMeta;
}

/** Errors shown to users. `code` is stable for tests; `message` is UI copy. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface CommandContext {
  now: Date;
  /** Uniform random in [0, 1). Inject for deterministic tests. */
  rand: () => number;
}
