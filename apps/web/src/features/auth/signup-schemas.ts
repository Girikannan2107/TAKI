import { z } from "zod";
import { DobSchema } from "@/lib/api/contracts/auth";
import { StateCodeSchema, VehicleCountRangeSchema } from "@/lib/api/contracts/common";

/** Step-1 forms (details). The server re-validates the whole signup body. */
const name = (label: string, max = 60) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .min(2, "Use at least 2 characters")
    .max(max, `Use at most ${max} characters`);

const terms = z.boolean().refine((v) => v, "Accept the Terms to continue");

export const customerDetailsSchema = z.object({
  fullName: name("your full name"),
  dob: z.string().min(1, "Enter your date of birth").pipe(DobSchema),
  acceptTerms: terms,
});
export type CustomerDetailsValues = z.input<typeof customerDetailsSchema>;

export const agencyDetailsSchema = z.object({
  ownerName: name("the owner's name"),
  agencyName: name("the agency name", 80),
  /** Google place (placeId) or, without Places, the typed town (placeId "" — geocoded at signup). */
  base: z.object({ placeId: z.string(), label: z.string() }, { error: "Choose the town or city you are based in" }).refine(
    (b) => b.label.trim().length >= 3,
    "Choose the town or city you are based in",
  ),
  vehicleCountRange: z.string().min(1, "Choose how many vehicles you run").pipe(VehicleCountRangeSchema),
  statesCovered: z.array(StateCodeSchema).min(1, "Choose at least one state"),
  acceptTerms: terms,
});
export type AgencyDetailsValues = z.input<typeof agencyDetailsSchema>;

/** "__invite__" = "My agency added me" (resolved from the invite at OTP verification). */
export const INVITE_CHOICE = "__invite__";

export const driverDetailsSchema = z.object({
  fullName: name("your full name"),
  agencyId: z.string().min(1, "Choose your agency"),
  acceptTerms: terms,
});
export type DriverDetailsValues = z.input<typeof driverDetailsSchema>;
