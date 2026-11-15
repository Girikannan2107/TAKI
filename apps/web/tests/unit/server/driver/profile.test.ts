import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDocStoreForTests } from "@/server/db";
import type { DriverDoc, NotificationDoc, ReviewDoc } from "@/server/db/schema";
import { getDriverProfile, requestAgencyLink } from "@/server/modules/driver/profile";
import type { MemoryDocStore } from "../../../support/memory-docstore";
import { AGENCY_ID, AGENCY_USER_ID, agencyDoc, baseStore, DRIVER_ID, NOW, session } from "./fixtures";

let store: MemoryDocStore;
beforeEach(() => {
  store = baseStore("rejected");
  setDocStoreForTests(store);
});
afterEach(() => setDocStoreForTests(null));

const OTHER_AGENCY = "agc_bbbbbbbbbbbbbbbbbbbb";

describe("driver profile", () => {
  it("returns the account profile with reviews (first names only)", async () => {
    const review: ReviewDoc = {
      id: "TAKI100001",
      bookingId: "TAKI100001",
      customerId: "usr_customeraaaaaaaaaaaa",
      customerFirstName: "Asha",
      driverId: DRIVER_ID,
      agencyId: AGENCY_ID,
      tripId: "trp_aaaaaaaaaaaaaaaaaaaa",
      rating: 5,
      comment: "Careful with fragile items",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    store.put("reviews", review.id, review);
    const p = await getDriverProfile(session());
    expect(p.account).toMatchObject({ role: "driver", fullName: "Ravi Kumar" });
    expect(p.account.documents.map((d) => d.kind)).toEqual(["driving_license", "aadhaar"]);
    expect(p.reviews).toEqual([expect.objectContaining({ rating: 5, customerFirstName: "Asha" })]);
    expect(JSON.stringify(p.reviews)).not.toContain("usr_customer");
  });

  it("requests a link to a verified agency and notifies its owner", async () => {
    store.put("agencies", OTHER_AGENCY, agencyDoc(OTHER_AGENCY));
    const p = await requestAgencyLink(session(), OTHER_AGENCY, NOW);
    expect(p.account.agencyLink).toMatchObject({ agencyId: OTHER_AGENCY, agencyName: "Madurai Movers", status: "pending", via: "request" });
    const notes = await store.query<NotificationDoc>("notifications", {});
    expect(notes).toEqual([expect.objectContaining({ userId: AGENCY_USER_ID, role: "agency", kind: "driver_link_requested", link: { type: "driver", id: DRIVER_ID } })]);
    // Repeating the same request is a no-op.
    await requestAgencyLink(session(), OTHER_AGENCY, NOW);
    expect(await store.query("notifications", {})).toHaveLength(1);
  });

  it("refuses unverified agencies and drivers who are already active", async () => {
    store.put("agencies", OTHER_AGENCY, agencyDoc(OTHER_AGENCY, "pending"));
    await expect(requestAgencyLink(session(), OTHER_AGENCY, NOW)).rejects.toMatchObject({ code: "not_found" });
    const d = (await store.get<DriverDoc>("drivers", DRIVER_ID))!;
    store.put("drivers", DRIVER_ID, { ...d, agencyLink: { ...d.agencyLink!, status: "active" } });
    store.put("agencies", OTHER_AGENCY, agencyDoc(OTHER_AGENCY));
    await expect(requestAgencyLink(session(), OTHER_AGENCY, NOW)).rejects.toMatchObject({ code: "conflict" });
  });
});
