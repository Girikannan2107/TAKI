import { ChangePhoneBody } from "@/lib/api/contracts/auth";
import { handler } from "@/server/http/handler";
import { changePhone } from "@/server/modules/profile/service";

/** POST /api/me/phone — { proofToken (change_phone OTP), currentPassword } → SessionUserDTO; other sessions signed out. */
export const POST = handler({ auth: ["customer", "agency", "driver"], body: ChangePhoneBody }, ({ body, session, now }) => changePhone(session, body, now));
