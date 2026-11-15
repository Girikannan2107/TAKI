/** Password login (/auth/login). Credentials are checked by authService.login. */
import { z } from "zod";
import { mobileField } from "./phone.schema";

export const LOGIN_MESSAGES = {
  passwordRequired: "Enter your password",
  invalidCredentials: "Mobile number or password is incorrect.",
} as const;

export const loginSchema = z.object({
  mobile: mobileField,
  password: z.string().min(1, LOGIN_MESSAGES.passwordRequired),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
