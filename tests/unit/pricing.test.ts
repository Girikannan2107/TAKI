import { describe, expect, it } from "vitest";
import { estimateDurationMins, paiseToRupeesString, quote, roundHalfUp, rupeesToPaise, serviceFeeFor } from "@/lib/domain/pricing";

describe("pricing contract", () => {
  it("rounds paise half-up to whole rupees", () => {
    expect(roundHalfUp(249750)).toBe(2498);
    expect(roundHalfUp(249749)).toBe(2497);
    expect(roundHalfUp(0)).toBe(0);
  });

  it("reproduces the Raj Transport payment summary (₹4,500 + ₹350 = ₹4,850)", () => {
    const q = quote({ distanceKm: 498, weightKg: 500, ratePerKmPaise: 750, ratePerKgPaise: 153 });
    expect(q.distanceCharge).toBe(3735);
    expect(q.weightCharge).toBe(765);
    expect(q.transportationCharge).toBe(4500);
    expect(q.serviceFee).toBe(350);
    expect(q.totalPayable).toBe(4850);
  });

  it("reproduces Sree Travels ₹5,200 and Kavin Logistics ₹5,450", () => {
    expect(quote({ distanceKm: 500, weightKg: 500, ratePerKmPaise: 850, ratePerKgPaise: 120 }).totalPayable).toBe(5200);
    expect(quote({ distanceKm: 520, weightKg: 500, ratePerKmPaise: 875, ratePerKgPaise: 110 }).totalPayable).toBe(5450);
  });

  it("reproduces the Set Pricing preview: 498 × ₹12 = ₹5,976; 500 × ₹0.50 = ₹250; ₹6,226", () => {
    const q = quote({ distanceKm: 498, weightKg: 500, ratePerKmPaise: 1200, ratePerKgPaise: 50 });
    expect([q.distanceCharge, q.weightCharge, q.transportationCharge]).toEqual([5976, 250, 6226]);
  });

  it("breakdown lines always add up", () => {
    for (let km = 1; km < 700; km += 37)
      for (const kg of [10, 333, 501, 1999, 2001, 25000]) {
        const q = quote({ distanceKm: km, weightKg: kg, ratePerKmPaise: 777, ratePerKgPaise: 133 });
        expect(q.transportationCharge).toBe(q.distanceCharge + q.weightCharge);
        expect(q.totalPayable).toBe(q.transportationCharge + q.serviceFee);
      }
  });

  it("service fee slabs", () => {
    expect([10, 500, 501, 1000, 1001, 2000, 2001].map(serviceFeeFor)).toEqual([350, 350, 500, 500, 750, 750, 1000]);
  });

  it("duration estimate: 498 km ≈ 543 min", () => {
    expect(estimateDurationMins(498)).toBe(543);
  });

  it("parses and formats rates in paise", () => {
    expect(rupeesToPaise("12")).toBe(1200);
    expect(rupeesToPaise("0.5")).toBe(50);
    expect(rupeesToPaise("7.50")).toBe(750);
    expect(Number.isNaN(rupeesToPaise("-1"))).toBe(true);
    expect(Number.isNaN(rupeesToPaise("1.234"))).toBe(true);
    expect(Number.isNaN(rupeesToPaise("abc"))).toBe(true);
    expect(paiseToRupeesString(50)).toBe("0.50");
    expect(paiseToRupeesString(1200)).toBe("12");
  });
});
