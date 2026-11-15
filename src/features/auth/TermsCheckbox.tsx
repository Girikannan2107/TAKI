"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui";

/** Required consent checkbox shared by the three signup forms. */
export function TermsCheckbox({ registration, error }: { registration: UseFormRegisterReturn; error?: string }) {
  return (
    <Checkbox
      id="acceptTerms"
      required
      aria-required="true"
      label="I agree to the TAKI Terms of Service and Privacy Policy"
      description="You must be 18 or older. We use your number only for your account and shipment updates."
      error={error}
      {...registration}
    />
  );
}
