import "server-only";
import { DomainError } from "@/lib/api/contracts/errors";
import type { SmsProvider } from "./types";

/**
 * MSG91 (DLT-compliant) provider. Fails closed with `sms_not_configured` (503) when keys are missing.
 * Uses the Flow API with a DLT template whose variables are `otp` and `minutes`.
 */
export function createMsg91Provider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const authKey = env.MSG91_AUTH_KEY;
  const otpTemplate = env.MSG91_OTP_TEMPLATE_ID;
  const sender = env.MSG91_SENDER_ID;

  async function flow(templateId: string, to: string, vars: Record<string, string>): Promise<{ messageId: string }> {
    if (!authKey || !sender || !templateId) throw new DomainError("sms_not_configured");
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ template_id: templateId, sender, short_url: "0", recipients: [{ mobiles: to.replace(/^\+/, ""), ...vars }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new DomainError("sms_not_configured", "We couldn't send the SMS right now. Please try again.", { status: 502 });
    const body = (await res.json().catch(() => ({}))) as { request_id?: string; message?: string };
    return { messageId: body.request_id ?? body.message ?? "msg91" };
  }

  return {
    name: "msg91",
    async sendOtp({ to, code, expiresInMinutes }) {
      return flow(otpTemplate ?? "", to, { otp: code, minutes: String(expiresInMinutes) });
    },
    async sendText({ to, templateId, vars }) {
      return flow(templateId, to, vars);
    },
  };
}
