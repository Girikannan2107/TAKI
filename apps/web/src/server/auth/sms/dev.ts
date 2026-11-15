import "server-only";
import { randomBytes } from "node:crypto";
import type { SmsProvider } from "./types";

/**
 * Development SMS provider: sends nothing. The code is returned to the API layer, which shows it to the user
 * labelled "Dev OTP". Logs only a masked recipient (never the code).
 */
export const devSmsProvider: SmsProvider = {
  name: "dev",
  async sendOtp({ to, code, purpose }) {
    if (process.env.VITEST !== "true") console.info(`[sms:dev] OTP (${purpose}) for …${to.slice(-4)} — shown on screen as "Dev OTP"`);
    return { messageId: `dev_${randomBytes(8).toString("hex")}`, devCode: code };
  },
  async sendText({ to, templateId }) {
    if (process.env.VITEST !== "true") console.info(`[sms:dev] text "${templateId}" for …${to.slice(-4)} (not sent)`);
    return { messageId: `dev_${randomBytes(8).toString("hex")}` };
  },
};
