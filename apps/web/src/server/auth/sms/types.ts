import "server-only";
import type { Mobile } from "@/lib/domain/model";

export type OtpPurpose = "signup" | "reset_password" | "change_phone";

/** SMS adapter (P2 §3.4). `dev` never sends anything and returns the code for the "Dev OTP" label. */
export interface SmsProvider {
  readonly name: "dev" | "msg91";
  sendOtp(input: { to: Mobile; code: string; purpose: OtpPurpose; expiresInMinutes: number }): Promise<{ messageId: string; devCode?: string }>;
  sendText(input: { to: Mobile; templateId: string; vars: Record<string, string> }): Promise<{ messageId: string }>;
}
