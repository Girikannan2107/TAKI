/** v2 password policy (P2 §3.3) as a live checklist; the server re-checks (plus "not your phone number"). */
export interface PasswordRule {
  id: "length" | "letter" | "number";
  label: string;
  test(password: string): boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", label: "8 to 64 characters", test: (p) => p.length >= 8 && p.length <= 64 },
  { id: "letter", label: "At least one letter", test: (p) => /[A-Za-z]/.test(p) },
  { id: "number", label: "At least one number", test: (p) => /\d/.test(p) },
];
