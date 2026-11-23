import { STATE_CODES, STATE_NAMES } from "@/lib/domain/model";

/** Service-state chips (agency signup and profile). */
export const STATE_CHOICES = STATE_CODES.map((s) => ({ value: s, label: STATE_NAMES[s] }));
