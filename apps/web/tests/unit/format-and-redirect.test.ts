import { describe, expect, it } from "vitest";
import { normalizeIndianMobile, toE164 } from "@/lib/domain/phone";
import {
  formatChangePct,
  formatDate,
  formatDateTime,
  formatDuration,
  formatINR,
  formatKg,
  formatPhone,
  formatRate,
  formatTime,
  pad2,
  shortName,
} from "@/lib/format";
import { safeRedirect } from "@/lib/utils/safe-redirect";

describe("formatting (en-IN, IST)", () => {
  it("money, units and counts", () => {
    expect(formatINR(4850)).toBe("₹4,850");
    expect(formatINR(186200)).toBe("₹1,86,200");
    expect(formatRate(50)).toBe("₹0.50");
    expect(formatRate(1200)).toBe("₹12");
    expect(formatKg(2000)).toBe("2,000 kg");
    expect(pad2(3)).toBe("03");
    expect(formatDuration(543)).toBe("~9 hr");
    expect(formatChangePct(12)).toBe("+12% vs last month");
  });

  it("dates and times", () => {
    expect(formatDate("2025-11-20")).toBe("20 Nov, 2025");
    expect(formatTime("08:00")).toBe("08:00 AM");
    expect(formatTime("21:30")).toBe("09:30 PM");
    expect(formatDateTime("2025-11-20T03:42:00.000Z")).toBe("20 Nov, 09:12 AM");
  });

  it("names and phones", () => {
    expect(shortName("Arjun Kumar")).toBe("Arjun K.");
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });
});

describe("Indian mobile validation", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["09876543210", "9876543210"],
    ["919876543210", "9876543210"],
  ])("accepts %s", (input, out) => expect(normalizeIndianMobile(input)).toBe(out));

  it.each(["", "12345", "5876543210", "98765432101", "98765abcde"])("rejects %s", (input) => expect(toE164(input)).toBeNull());
});

describe("safeRedirect", () => {
  it("allows own-section relative paths", () => {
    expect(safeRedirect("/customer/payment?bookingId=TAKI123456", "customer")).toBe("/customer/payment?bookingId=TAKI123456");
    expect(safeRedirect("%2Fdriver%2Fearnings", "driver")).toBe("/driver/earnings");
  });

  it.each([
    ["https://evil.example", "customer"],
    ["//evil.example", "customer"],
    ["/\\evil.example", "customer"],
    ["javascript:alert(1)", "customer"],
    ["/driver/earnings", "customer"],
    ["/customerx", "customer"],
    ["", "customer"],
  ] as const)("rejects %s for %s", (next, role) => expect(safeRedirect(next, role)).toBeNull());
});
