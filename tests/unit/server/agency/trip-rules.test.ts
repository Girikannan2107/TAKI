import { describe, expect, it } from "vitest";
import { isValidReg, normalizeReg, TripBody } from "@/lib/api/contracts/agency";
import { capacityIssues, checkpointIssues, goodsIssues, isoToIstLocal, istLocalToIso, publishBlockers, publishTimingProblem } from "@/lib/domain/trip-rules";

const NOW = new Date("2026-11-20T04:30:00.000Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("trip-rules: checkpoints", () => {
  it("accepts an ordered route with increasing times", () => {
    expect(
      checkpointIssues([
        { placeId: "coimbatore", expectedArrivalAt: null, expectedDepartureAt: at(24) },
        { placeId: "erode", expectedArrivalAt: at(26), expectedDepartureAt: at(26.5) },
        { placeId: "salem", expectedArrivalAt: at(28), expectedDepartureAt: null },
      ]),
    ).toEqual([]);
  });

  it("flags missing times, out-of-order times, repeated districts and unknown places", () => {
    const issues = checkpointIssues([
      { placeId: "coimbatore", expectedArrivalAt: null, expectedDepartureAt: at(24) },
      { placeId: "erode", expectedArrivalAt: at(23), expectedDepartureAt: at(22) },
      { placeId: "pollachi", expectedArrivalAt: at(25), expectedDepartureAt: at(26) }, // same district as Coimbatore
      { placeId: "atlantis", expectedArrivalAt: at(27), expectedDepartureAt: at(28) },
      { placeId: "salem", expectedArrivalAt: null, expectedDepartureAt: null },
    ]);
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("checkpoints.1.expectedArrivalAt"); // arrival before leaving source
    expect(paths).toContain("checkpoints.1.expectedDepartureAt"); // departure before arrival
    expect(paths).toContain("checkpoints.2.placeId"); // district repeated
    expect(paths).toContain("checkpoints.3.placeId"); // unknown
    expect(paths).toContain("checkpoints.4.expectedArrivalAt"); // destination needs arrival
  });

  it("needs at least a source and a destination", () => {
    expect(checkpointIssues([{ placeId: "coimbatore", expectedArrivalAt: null, expectedDepartureAt: at(1) }]).map((i) => i.path)).toContain("checkpoints");
  });
});

describe("trip-rules: capacity, goods, publishing", () => {
  it("keeps offered ≤ max ≤ vehicle payload and ≥ 100 kg", () => {
    expect(capacityIssues({ offeredKg: 800, maxCapacityKg: 1000, vehiclePayloadKg: 1500 })).toEqual([]);
    expect(capacityIssues({ offeredKg: 1200, maxCapacityKg: 1000, vehiclePayloadKg: 1500 }).map((i) => i.path)).toEqual(["offeredKg"]);
    expect(capacityIssues({ offeredKg: 50, vehiclePayloadKg: 1500 }).map((i) => i.path)).toEqual(["offeredKg"]);
    expect(capacityIssues({ offeredKg: 500, maxCapacityKg: 2000, vehiclePayloadKg: 1500 }).map((i) => i.path)).toContain("maxCapacityKg");
  });

  it("only allows goods and handling the vehicle supports", () => {
    const vehicle = { acceptedGoods: ["general_goods", "textiles"] as const, handlingSupported: ["fragile"] as const };
    expect(goodsIssues({ acceptedGoods: ["textiles"], handlingSupported: ["fragile"] }, { ...vehicle, acceptedGoods: [...vehicle.acceptedGoods], handlingSupported: [...vehicle.handlingSupported] })).toEqual([]);
    const bad = goodsIssues({ acceptedGoods: ["perishables"], handlingSupported: ["keep_dry"] }, { acceptedGoods: [...vehicle.acceptedGoods], handlingSupported: [...vehicle.handlingSupported] });
    expect(bad.map((i) => i.path).sort()).toEqual(["acceptedGoods", "handlingSupported"]);
  });

  it("blocks publishing when unverified, too soon or too far ahead", () => {
    expect(publishTimingProblem(at(0.5), NOW)).toMatch(/at least/);
    expect(publishTimingProblem(at(24 * 90), NOW)).toMatch(/days ahead/);
    expect(publishTimingProblem(at(24), NOW)).toBeNull();
    const blockers = publishBlockers({ agencyVerified: false, vehicleActive: true, driverActive: false, departureAt: at(24), now: NOW });
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toMatch(/verified/);
  });

  it("converts IST datetime-local strings both ways", () => {
    expect(istLocalToIso("2026-11-21T08:00")).toBe("2026-11-21T02:30:00.000Z");
    expect(isoToIstLocal("2026-11-21T02:30:00.000Z")).toBe("2026-11-21T08:00");
    expect(istLocalToIso("")).toBeNull();
    expect(istLocalToIso("21/11/2026")).toBeNull();
  });
});

describe("agency contracts", () => {
  it("normalises registration numbers", () => {
    expect(normalizeReg("tn37xx4587")).toBe("TN 37 XX 4587");
    expect(normalizeReg("ka 1 ab 12")).toBe("KA 01 AB 0012");
    expect(normalizeReg("22bh1234aa")).toBe("22 BH 1234 AA");
    expect(isValidReg("TN 37 XX 4587")).toBe(true);
    expect(isValidReg("HELLO")).toBe(false);
  });

  it("TripBody maps checkpoint rule issues onto field paths and requires rates to publish", () => {
    const r = TripBody.safeParse({
      vehicleId: "veh_aaaaaaaaaaaaaaaaaaaa",
      driverId: "usr_aaaaaaaaaaaaaaaaaaaa",
      offeredKg: 500,
      acceptedGoods: ["general_goods"],
      publish: true,
      checkpoints: [
        { placeId: "coimbatore", expectedArrivalAt: null, expectedDepartureAt: at(24) },
        { placeId: "salem", expectedArrivalAt: at(20), expectedDepartureAt: null },
      ],
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("checkpoints.1.expectedArrivalAt");
    expect(paths).toContain("ratePerKmPaise");
    expect(paths).toContain("ratePerKgPaise");
  });
});
