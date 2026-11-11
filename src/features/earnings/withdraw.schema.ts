import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";
import { formatINR } from "@/lib/format";

/** Whole-rupee withdrawal amount between ₹100 and the available balance. Commas/spaces are ignored. */
export function withdrawAmountSchema(available: number) {
  return z
    .string()
    .transform((raw) => raw.replace(/[,\s]/g, ""))
    .superRefine((value, ctx) => {
      if (value === "") return void ctx.addIssue({ code: "custom", message: "Enter an amount to withdraw" });
      if (!/^\d+$/.test(value)) return void ctx.addIssue({ code: "custom", message: "Enter a whole rupee amount, e.g. 10000" });
      const n = Number(value);
      if (n < LIMITS.minWithdrawal) return void ctx.addIssue({ code: "custom", message: `Minimum withdrawal is ${formatINR(LIMITS.minWithdrawal)}` });
      if (n > available) ctx.addIssue({ code: "custom", message: `You can withdraw up to ${formatINR(available)}` });
    })
    .transform(Number);
}
