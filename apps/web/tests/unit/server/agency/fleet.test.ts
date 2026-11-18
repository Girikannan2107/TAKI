/** Agency fleet: vehicles CRUD, driver invites, approve/reject self-registered drivers, isolation (D2). */
import { beforeEach, describe, expect, it } from "vitest";
import { getDocStore } from "@/server/db";
import { C } from "@/server/db/collections";
import type { DriverDoc } from "@/server/db/schema";
import { approveDriver, getDriver, listDrivers, rejectDriver, removeDriver, setAvailability } from "@/server/modules/agency/drivers";
import { createInvite, listInvites, revokeInvite } from "@/server/modules/agency/invites";
import { createVehicle, listVehicles, removeVehicle, updateVehicle } from "@/server/modules/agency/vehicles";
import { accountOps, driverDoc } from "@/server/seed/builders";
import { freshStore } from "../../../support/harness";
import { createTrip, createWorld, type World } from "../../../support/world";

const NOW = new Date("2026-11-20T04:30:00.000Z");
let w: World;

const vehicleInput = (reg = "tn38zz1234") => ({
  vehicleClass: "Light Truck" as const,
  modelId: "tata_407" as const,
  makeModel: "Tata 407",
  registrationNumber: reg,
  maxPayloadKg: 3000,
  bodyType: "closed" as const,
  dimensionsFt: null,
  acceptedGoods: ["general_goods" as const, "textiles" as const],
  handlingSupported: ["fragile" as const],
});

async function pendingDriver(world: World, phone = "+919811111111"): Promise<DriverDoc> {
  const acc = accountOps({ role: "driver", phone, displayName: "Selvam", passwordHash: "x", now: NOW });
  const doc = driverDoc(acc.user, {
    fullName: "Selvam",
    agency: world.agency,
    linkStatus: "pending",
    via: "request",
    photoFileId: "fil_photoxxxxxxxxxxxxxxx",
    licenseFileId: "fil_licxxxxxxxxxxxxxxxxx",
    aadhaarFileId: "fil_aadxxxxxxxxxxxxxxxxx",
    now: NOW,
    seq: 77,
  });
  await getDocStore().batchWrite([...acc.ops, { op: "create", col: C.drivers, id: doc.id, data: doc }]);
  return doc;
}

beforeEach(async () => {
  await freshStore();
  w = await createWorld(NOW);
});

describe("vehicles", () => {
  it("creates a vehicle with a normalised, platform-unique registration", async () => {
    const v = await createVehicle(w.owner, vehicleInput(), NOW);
    expect(v.registrationNumber).toBe("TN 38 ZZ 1234");
    expect(v.status).toBe("active");
    expect(v.imageKey).toBeTruthy();

    await expect(createVehicle(w.owner, vehicleInput("TN 38 ZZ 1234"), NOW)).rejects.toMatchObject({ fields: { registrationNumber: expect.any(String) } });
    const other = await createWorld(NOW);
    await expect(createVehicle(other.owner, vehicleInput("tn-38-zz-1234"), NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("edits, deactivates and soft-removes a vehicle without live trips", async () => {
    const v = await createVehicle(w.owner, vehicleInput(), NOW);
    const edited = await updateVehicle(w.owner, v.id, { maxPayloadKg: 2500, status: "inactive" }, NOW);
    expect(edited.maxPayloadKg).toBe(2500);
    expect(edited.status).toBe("inactive");
    await removeVehicle(w.owner, v.id, NOW);
    const list = await listVehicles(w.owner, "all");
    expect(list.items.map((x) => x.id)).not.toContain(v.id);
  });

  it("blocks removing a vehicle with a published trip", async () => {
    await createTrip(w, { vehicle: 0 });
    await expect(removeVehicle(w.owner, w.vehicles[0]!.id, NOW)).rejects.toMatchObject({ status: 409 });
    const list = await listVehicles(w.owner, "all");
    expect(list.items.find((x) => x.id === w.vehicles[0]!.id)?.activeTrips).toBe(1);
  });

  it("hides other agencies' vehicles (404, no existence leak)", async () => {
    const other = await createWorld(NOW);
    await expect(updateVehicle(other.owner, w.vehicles[0]!.id, { makeModel: "Hijack" }, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(removeVehicle(other.owner, w.vehicles[0]!.id, NOW)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses non-agency sessions", async () => {
    await expect(listVehicles(w.drivers[0]!.session, "all")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("drivers & invites", () => {
  it("invites a new phone once; duplicates and existing driver accounts are refused", async () => {
    const inv = await createInvite(w.owner, { fullName: "Murugan", phone: "9876512345" }, NOW);
    expect(inv.status).toBe("pending");
    expect(inv.phone).toBe("+919876512345");
    await expect(createInvite(w.owner, { fullName: "Murugan", phone: "9876512345" }, NOW)).rejects.toMatchObject({ code: "already_exists" });
    await expect(createInvite(w.owner, { fullName: "Driver 1", phone: w.drivers[0]!.doc.phone }, NOW)).rejects.toMatchObject({ code: "phone_taken" });

    await revokeInvite(w.owner, inv.id, NOW);
    const after = await listInvites(w.owner, NOW);
    expect(after.items.find((i) => i.id === inv.id && i.status === "pending")).toBeUndefined();
    // A revoked number can be invited again.
    await expect(createInvite(w.owner, { fullName: "Murugan", phone: "9876512345" }, NOW)).resolves.toMatchObject({ status: "pending" });
  });

  it("approves a self-registered driver (idempotent) and they become assignable", async () => {
    const d = await pendingDriver(w);
    const pending = await listDrivers(w.owner, "pending", NOW);
    expect(pending.items.map((x) => x.id)).toEqual([d.id]);

    const approved = await approveDriver(w.owner, d.id, NOW);
    expect(approved.link.status).toBe("active");
    await expect(approveDriver(w.owner, d.id, NOW)).resolves.toMatchObject({ link: { status: "active" } });
    await expect(rejectDriver(w.owner, d.id, "late", NOW)).rejects.toMatchObject({ code: "invalid_transition" });

    const active = await listDrivers(w.owner, "active", NOW);
    expect(active.items.map((x) => x.id)).toContain(d.id);
  });

  it("rejects a pending request with a reason and notifies the driver", async () => {
    const d = await pendingDriver(w, "+919822222222");
    const r = await rejectDriver(w.owner, d.id, "Not hiring", NOW);
    expect(r.link.status).toBe("rejected");
    const notes = await getDocStore().query<{ userId: string; body: string }>(C.notifications, { where: [["userId", "==", d.id]] });
    expect(notes.some((n) => n.body.includes("Not hiring"))).toBe(true);
  });

  it("blocks removing a driver on a live trip, allows it otherwise", async () => {
    await createTrip(w, { driver: 0 });
    await expect(removeDriver(w.owner, w.drivers[0]!.doc.id, NOW)).rejects.toMatchObject({ code: "driver_has_active_trips" });
    await removeDriver(w.owner, w.drivers[1]!.doc.id, NOW);
    const active = await listDrivers(w.owner, "active", NOW);
    expect(active.items.map((x) => x.id)).not.toContain(w.drivers[1]!.doc.id);
  });

  it("shows the driver's schedule and toggles availability", async () => {
    await createTrip(w, { driver: 0 });
    const detail = await getDriver(w.owner, w.drivers[0]!.doc.id, NOW);
    expect(detail.schedule).toHaveLength(1);
    expect(detail.nextAssignment).not.toBeNull();
    expect(detail.phone).toBe(w.drivers[0]!.doc.phone);
    const off = await setAvailability(w.owner, w.drivers[0]!.doc.id, "unavailable", NOW);
    expect(off.availability).toBe("unavailable");
  });

  it("hides other agencies' drivers", async () => {
    const other = await createWorld(NOW);
    await expect(getDriver(other.owner, w.drivers[0]!.doc.id, NOW)).rejects.toMatchObject({ code: "not_found" });
  });
});
