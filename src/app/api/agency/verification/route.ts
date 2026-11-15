import { handler } from "@/server/http/handler";
import { submitVerification } from "@/server/modules/agency/profile";

/** POST /api/agency/verification (multipart: kind, number, file, backFile?, photo?) → profile · 409 when already verified */
export const POST = handler({ auth: "agency", form: true }, ({ session, form, now }) => submitVerification(session, form!, now));
