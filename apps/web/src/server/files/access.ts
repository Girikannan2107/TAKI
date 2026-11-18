import "server-only";
/**
 * File access control (P2 §4.7 `canReadFile`). D1 owns the route file
 * `src/app/api/files/[fileId]/route.ts`; it should be just:
 *
 *   export const GET = handler({ auth: "any", params: z.object({ fileId: IdSchema("fil") }) },
 *     ({ params, session }) => serveFile(session, params.fileId));
 *
 * Unreadable and missing files both return 404 (no existence leak).
 */
import { DomainError } from "@/lib/api/contracts/errors";
import { HOLDING_STATUSES } from "@/lib/domain/booking-machine";
import { C } from "../db/collections";
import { getDocStore } from "../db";
import type { BookingDoc, DriverDoc, FileDoc } from "../db/schema";
import type { SessionContext } from "../core/context";
import { getFileStore } from "./filestore";

const IDENTITY_KINDS = new Set(["aadhaar", "pan", "driving_license"]);

function isOwner(viewer: SessionContext, f: FileDoc): boolean {
  if (f.uploadedBy === viewer.userId && f.ownerType !== "booking" && f.ownerType !== "vehicle") return true;
  if (f.ownerType === "customer" || f.ownerType === "driver") return f.ownerId === viewer.userId;
  if (f.ownerType === "agency") return viewer.agencyId !== null && f.ownerId === viewer.agencyId;
  return false;
}

async function driverLinkedToViewerAgency(viewer: SessionContext, driverId: string): Promise<boolean> {
  if (viewer.role !== "agency" || !viewer.agencyId) return false;
  const d = await getDocStore().get<DriverDoc>(C.drivers, driverId);
  const link = d?.agencyLink;
  return !!link && link.agencyId === viewer.agencyId && (link.status === "active" || link.status === "pending");
}

async function sharesBooking(where: Array<readonly [string, "==", string]>, statuses: readonly string[]): Promise<boolean> {
  const rows = await getDocStore().query<BookingDoc>(C.bookings, { where, limit: 50 });
  return rows.some((b) => statuses.includes(b.status));
}

/** Authorisation for reading one file. */
export async function canReadFile(viewer: SessionContext, f: FileDoc): Promise<boolean> {
  if (f.status === "deleted") return false;
  if (viewer.role === "admin") return true;
  if (isOwner(viewer, f)) return true;

  if (IDENTITY_KINDS.has(f.kind)) {
    // Linked agency may review its drivers' documents.
    return f.ownerType === "driver" && (await driverLinkedToViewerAgency(viewer, f.ownerId));
  }

  if (f.kind === "vehicle_photo") return true; // any signed-in user (search results)

  if (f.kind === "delivery_proof") {
    if (f.ownerType !== "booking") return false;
    const b = await getDocStore().get<BookingDoc>(C.bookings, f.ownerId);
    if (!b) return false;
    return b.customerId === viewer.userId || b.driverId === viewer.userId || (viewer.agencyId !== null && b.agencyId === viewer.agencyId);
  }

  if (f.kind === "profile_photo") {
    const accepted = HOLDING_STATUSES as readonly string[];
    if (f.ownerType === "driver") {
      if (await driverLinkedToViewerAgency(viewer, f.ownerId)) return true;
      if (viewer.role === "customer") return sharesBooking([["customerId", "==", viewer.userId], ["driverId", "==", f.ownerId]], accepted);
      return false;
    }
    if (f.ownerType === "agency") {
      if (viewer.role === "customer") return sharesBooking([["customerId", "==", viewer.userId], ["agencyId", "==", f.ownerId]], [...accepted, "awaiting_agency"]);
      if (viewer.role === "driver") {
        const d = await getDocStore().get<DriverDoc>(C.drivers, viewer.userId);
        return d?.agencyLink?.agencyId === f.ownerId;
      }
      return false;
    }
    if (f.ownerType === "customer") {
      if (viewer.role === "agency" && viewer.agencyId) return sharesBooking([["customerId", "==", f.ownerId], ["agencyId", "==", viewer.agencyId]], [...accepted, "awaiting_agency"]);
      if (viewer.role === "driver") return sharesBooking([["customerId", "==", f.ownerId], ["driverId", "==", viewer.userId]], ["confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered"]);
      return false;
    }
  }
  return false;
}

/** Load + authorise; throws not_found when missing OR not readable. */
export async function readFileForViewer(viewer: SessionContext, fileId: string): Promise<{ doc: FileDoc; bytes: Uint8Array; contentType: string }> {
  const doc = await getDocStore().get<FileDoc>(C.files, fileId);
  if (!doc || !(await canReadFile(viewer, doc))) throw new DomainError("not_found");
  const blob = await getFileStore().get(doc.storagePath);
  if (!blob) throw new DomainError("not_found");
  return { doc, bytes: blob.bytes, contentType: doc.contentType };
}

/** Streamable Response for GET /api/files/[fileId]. */
export async function serveFile(viewer: SessionContext, fileId: string): Promise<Response> {
  const { bytes, contentType } = await readFileForViewer(viewer, fileId);
  return new Response(new Blob([bytes as BlobPart], { type: contentType }), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
