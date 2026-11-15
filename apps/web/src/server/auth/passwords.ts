import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * scrypt password hashing (P2 §3.3). Format: `scrypt$v1$<N>$<r>$<p>$<saltB64url>$<hashB64url>`.
 * No native dependency. Hashes with outdated parameters are re-hashed on the next successful login.
 */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const b64u = (b: Buffer) => b.toString("base64url");

export async function hashPassword(password: string, params: { N: number; r: number; p: number } = SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_PARAMS.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_PARAMS.maxmem });
  return `scrypt$v1$${params.N}$${params.r}$${params.p}$${b64u(salt)}$${b64u(key)}`;
}

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") return null;
  const [N, r, p] = [Number(parts[2]), Number(parts[3]), Number(parts[4])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  if (N > 2 ** 20 || r > 32 || p > 16) return null; // refuse absurd params (DoS)
  const salt = Buffer.from(parts[5]!, "base64url");
  const hash = Buffer.from(parts[6]!, "base64url");
  if (salt.length < 8 || hash.length < 32) return null;
  return { N, r, p, salt, hash };
}

/** A real hash of a random password, used for unknown phones so timing doesn't reveal account existence. */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(18).toString("base64url"));
  return dummyHash;
}

export interface VerifyResult {
  ok: boolean;
  /** True when ok and the stored hash uses outdated parameters (caller should store a fresh hash). */
  needsRehash: boolean;
}

/** Constant-time verification. Pass `stored = null` for unknown accounts (still does the scrypt work). */
export async function verifyPassword(password: string, stored: string | null): Promise<VerifyResult> {
  const parsed = stored ? parse(stored) : null;
  const target = parsed ?? parse(await getDummyHash())!;
  const key = await scrypt(password.slice(0, PASSWORD_MAX * 4), target.salt, target.hash.length, {
    N: target.N,
    r: target.r,
    p: target.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  const ok = !!parsed && key.length === target.hash.length && timingSafeEqual(key, target.hash);
  const needsRehash =
    ok && (target.N !== SCRYPT_PARAMS.N || target.r !== SCRYPT_PARAMS.r || target.p !== SCRYPT_PARAMS.p || target.hash.length !== SCRYPT_PARAMS.keylen);
  return { ok, needsRehash };
}

/**
 * Password policy (P2 §3.3): 8–64 chars, ≥1 letter, ≥1 digit, not the phone number.
 * Returns a user-facing problem or null.
 */
export function passwordProblem(password: string, phoneE164?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/\d/.test(password)) return "Include at least one number.";
  if (phoneE164) {
    const digits = phoneE164.replace(/\D/g, "");
    const local = digits.slice(-10);
    const pw = password.replace(/\s/g, "");
    if (pw === digits || pw === local || pw === `+${digits}`) return "Don't use your phone number as your password.";
  }
  return null;
}
