"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui";
import { paths } from "@/lib/config/routes";

const linkCls = "font-semibold text-green-700 underline underline-offset-2 hover:text-green-800";

/** Required consent checkbox shared by the three signup forms. */
export function TermsCheckbox({ registration, error }: { registration: UseFormRegisterReturn; error?: string }) {
  return (
    <Checkbox
      id="acceptTerms"
      required
      aria-required="true"
      label={
        <>
          I agree to the TAKI{" "}
          <a href={paths.legal.terms} target="_blank" rel="noopener" className={linkCls}>
            Terms of Service
          </a>{" "}
          and{" "}
          <a href={paths.legal.privacy} target="_blank" rel="noopener" className={linkCls}>
            Privacy Policy
          </a>
        </>
      }
      description="You must be 18 or older. We use your number only for your account and shipment updates."
      error={error}
      {...registration}
    />
  );
}
