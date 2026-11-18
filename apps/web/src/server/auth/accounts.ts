import "server-only";
import type { Mobile } from "@/lib/domain/model";
import { C, getDocStore, type TxContext } from "@/server/db";
import type { PhoneIndexDoc, UserDoc } from "@/server/db/schema";

/**
 * Plan decision 3: one phone number = one account = one role. `phoneIndex/{e164}` enforces uniqueness
 * (created with tx.create in the signup / phone-change transaction, so a duplicate fails the transaction).
 */
export function phoneIndexKey(e164: Mobile): string {
  return e164;
}

export async function findUserByPhone(phone: Mobile, tx?: TxContext): Promise<UserDoc | null> {
  const reader = tx ?? getDocStore();
  const idx = await reader.get<PhoneIndexDoc>(C.phoneIndex, phoneIndexKey(phone));
  if (!idx) return null;
  return reader.get<UserDoc>(C.users, idx.userId);
}

export async function getUser(userId: string, tx?: TxContext): Promise<UserDoc | null> {
  return (tx ?? getDocStore()).get<UserDoc>(C.users, userId);
}

/** First word of a name, for greetings. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
