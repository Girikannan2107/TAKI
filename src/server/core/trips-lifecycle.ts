import "server-only";
/**
 * Trip lifecycle commands (P2 §5.2, §6.4). D2 owns trip drafts (create/update in
 * modules/agency/trips.ts); everything that touches schedules, capacity or bookings is here.
 */
import { DomainError } from "@/lib/api/contracts/errors";
import type { Id, IsoDateTime } from "@/lib/domain/model";
import type { TripDoc } from "../db/schema";
import type { Ctx } from "./context";

const notImplemented = (): never => {
  throw new DomainError("not_implemented");
};

export const tripsLifecycle = {
  /** draft → published: agency verified, vehicle active, driver linked+available, schedules free. */
  async publish(_ctx: Ctx, _tripId: Id): Promise<TripDoc> {
    return notImplemented();
  },
  /** published → draft when no awaiting/held bookings. */
  async unpublish(_ctx: Ctx, _tripId: Id): Promise<TripDoc> {
    return notImplemented();
  },
  /** draft|published → cancelled; cascades to bookings (rejected/cancelled + refunds). */
  async cancel(_ctx: Ctx, _tripId: Id, _reason: string): Promise<TripDoc> {
    return notImplemented();
  },
  /** Swap the driver of a draft/published trip (schedule-checked, bookings fanned out). */
  async reassignDriver(_ctx: Ctx, _tripId: Id, _driverId: Id): Promise<TripDoc> {
    return notImplemented();
  },
  /** Driver arrives at / departs checkpoint `index`. Departing 0 starts the trip. */
  async checkpoint(_ctx: Ctx, _tripId: Id, _index: number, _kind: "arrive" | "depart", _i: { remarks?: string; clientAt?: IsoDateTime }): Promise<TripDoc> {
    return notImplemented();
  },
  /** in_progress → completed once the last checkpoint is reached and all held bookings are closed. */
  async complete(_ctx: Ctx, _tripId: Id): Promise<TripDoc> {
    return notImplemented();
  },
};
